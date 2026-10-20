// Prepara la guía de programación de Tommy TV a partir de guías públicas (epgshare01, formato XMLTV).
// - Baja cada fuente, se queda con los programas de las próximas horas y escribe:
//     salida/indice.json        → [fuente, número, nombres...] de cada canal con programación
//     salida/p/<fuente>/<n>.json → programas de ese canal: [inicio (min), duración (min), título, descripción]
//     salida/b/<abc>.json        → buscador: [fuente, número, título, [inicio, duración, …]] de lo que pasan en las próximas 36 h,
//                                  repartido por las 3 primeras letras de cada palabra del título (la app baja solo un pedazo)
// - Lee las fuentes como flujo (la de canales locales de EE. UU. pesa más de 500 MB sin comprimir).
// Uso: node construir.mjs [carpeta-salida]
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';

const BASE = 'https://epgshare01.online/epgshare01/epg_ripper_';
// fuente → país (la app la prefiere para los canales de ese país)
const FUENTES = {
  mx1: 'mx', ar1: 'ar', co1: 'co', cl1: 'cl', pe1: 'pe', cr1: 'cr', pa1: 'pa', sv1: 'ca', do1: 'do', ec1: 'ec', uy1: 'uy',
  us2: 'us', us_sports1: 'us', us_locals1: 'us', bein1: 'us', directvsports1: 'lat', es1: 'es', uk1: 'uk', ca2: 'cnd',
};
const SALIDA = process.argv[2] || 'salida';
const DESDE = Date.now() - 3 * 36e5, HASTA = Date.now() + 36 * 36e5;

const des = (t) => String(t || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;|&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const fecha = (t) => {
  const m = String(t).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/); if (!m) return NaN;
  const z = m[7] || '+0000', min = (+z.slice(1, 3) * 60 + +z.slice(3)) * (z[0] === '-' ? -1 : 1);
  return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - min * 60000;
};

async function leerFuente(codigo) {
  const r = await fetch(BASE + codigo.toUpperCase() + '.xml.gz');
  if (!r.ok) throw new Error(codigo + ': HTTP ' + r.status);
  const canales = new Map(), progs = new Map();
  let resto = '';
  const flujo = Readable.fromWeb(r.body).pipe(createGunzip());
  flujo.setEncoding('utf8');
  for await (const trozo of flujo) {
    resto += trozo;
    let corte = 0;
    for (const m of resto.matchAll(/<channel\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/channel>|<programme\s+([^>]*)>([\s\S]*?)<\/programme>/g)) {
      corte = m.index + m[0].length;
      if (m[1] !== undefined) {
        canales.set(m[1], [...m[2].matchAll(/<display-name[^>]*>([\s\S]*?)<\/display-name>/g)].map((n) => des(n[1])).filter(Boolean));
      } else {
        const c = (m[3].match(/channel="([^"]*)"/) || [])[1]; if (!c) continue;
        const ini = fecha((m[3].match(/start="([^"]*)"/) || [])[1]), fin = fecha((m[3].match(/stop="([^"]*)"/) || [])[1]);
        if (!(fin > DESDE) || !(ini < HASTA) || !(fin > ini)) continue;
        const titulo = des((m[4].match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]) || 'Sin título';
        let desc = des((m[4].match(/<desc[^>]*>([\s\S]*?)<\/desc>/) || [])[1]);
        if (desc.length > 320) desc = desc.slice(0, 317).replace(/\s+\S*$/, '') + '…';
        (progs.get(c) || progs.set(c, []).get(c)).push([Math.round(ini / 60000), Math.round((fin - ini) / 60000), titulo, desc]);
      }
    }
    resto = resto.slice(corte);
    if (resto.length > 4e6) resto = resto.slice(-1e6); // basura sin cerrar: no dejar crecer la memoria
  }
  return { canales, progs };
}

rmSync(SALIDA, { recursive: true, force: true });
const indice = [], resumen = {}, buscador = new Map();
// Igual que en la app: sin acentos, minúsculas, solo letras y números
const palabras = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 3 && !VACIAS.has(w));
const VACIAS = new Set('the and los las del con por una que for with les des und una sus'.split(' '));
const AHORA = Math.round(Date.now() / 60000);
for (const [codigo, pais] of Object.entries(FUENTES)) {
  const t0 = Date.now();
  try {
    const { canales, progs } = await leerFuente(codigo);
    mkdirSync(`${SALIDA}/p/${codigo}`, { recursive: true });
    let n = 0;
    for (const [id, nombres] of canales) {
      const ps = progs.get(id); if (!ps || !ps.length) continue;
      ps.sort((a, b) => a[0] - b[0]);
      // Además de los nombres, el identificador sirve para reconocer: «Univision.Network.HD.us2» → «Univision Network HD»
      const deId = id.replace(/\.[a-z_0-9]+$/i, '').replace(/[._]+/g, ' ').trim();
      indice.push([codigo, n, ...new Set([...nombres, deId])]);
      writeFileSync(`${SALIDA}/p/${codigo}/${n}.json`, JSON.stringify(ps));
      const porTitulo = new Map();
      for (const [ini, dur, titulo] of ps) if (ini + dur > AHORA && ini < AHORA + 36 * 60) (porTitulo.get(titulo) || porTitulo.set(titulo, []).get(titulo)).push(ini, dur);
      for (const [titulo, horas] of porTitulo) {
        const e = [codigo, n, titulo, horas];
        for (const k of new Set(palabras(titulo).map((w) => w.slice(0, 3)))) (buscador.get(k) || buscador.set(k, []).get(k)).push(e);
      }
      n++;
    }
    resumen[codigo] = { pais, canales: n, segundos: Math.round((Date.now() - t0) / 1000) };
  } catch (e) {
    resumen[codigo] = { pais, error: String(e.message || e) };
  }
  console.log(codigo.padEnd(15), JSON.stringify(resumen[codigo]));
}
mkdirSync(`${SALIDA}/b`, { recursive: true });
for (const [k, v] of buscador) writeFileSync(`${SALIDA}/b/${encodeURIComponent(k)}.json`, JSON.stringify(v));
console.log('buscador:', buscador.size, 'pedazos');
writeFileSync(`${SALIDA}/indice.json`, JSON.stringify({ generado: Date.now(), fuentes: Object.fromEntries(Object.entries(FUENTES)), canales: indice }));
writeFileSync(`${SALIDA}/estado.json`, JSON.stringify({ generado: new Date().toISOString(), resumen }, null, 1));
console.log('canales con programación:', indice.length);
