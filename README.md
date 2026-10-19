# Guía de programación de Tommy TV

Junta guías de TV públicas (formato XMLTV de [epgshare01](https://epgshare01.online/epgshare01/)) de México, Latinoamérica,
EE. UU. (nacionales, deportes y canales locales), España, Reino Unido y Canadá, y las deja listas para la app Tommy TV:

- `indice.json`: cada canal con programación → `[fuente, número, nombres...]`.
- `p/<fuente>/<número>.json`: sus programas de las próximas ~36 horas → `[inicio (minutos UTC), duración (min), título, descripción]`.

La app baja el índice (≈70 KB comprimido), reconoce los canales de cada usuario por su nombre (prefiere las guías de su país)
y luego baja solo los programas de los canales que está viendo (≈7 KB cada uno).

- Se arma sola cada 6 horas con GitHub Actions (`.github/workflows/guia.yml`) y se publica en GitHub Pages.
- Para probar en una Mac: `node construir.mjs salida` (unos 20 segundos).
- No contiene canales ni videos: solo horarios de programación públicos.
