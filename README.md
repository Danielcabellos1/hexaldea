# Hexaldea

Juego de mesa de construir y comerciar para jugar con los colegas: el tablero en la tele y las cartas de cada uno en su móvil.

**Jugar:** https://danielcabellos1.github.io/hexaldea/

## Cómo se juega en casa

1. En el portátil conectado a la tele (o en una pestaña enviada al Chromecast) abre la página y pulsa **Crear partida**.
2. Cada uno escanea el QR con la cámara del móvil, escribe su nombre y elige color.
3. El anfitrión pulsa **Empezar partida**. De 2 a 6 jugadores; con 5 o 6 el tablero es más grande.

- No hace falta cuenta ni instalar nada.
- Si a alguien se le cierra la página, vuelve a abrir el enlace y recupera su sitio.
- La pantalla que crea la partida tiene que seguir abierta: es la que guarda la partida.
- Se pueden añadir bots para rellenar huecos, o practicar uno solo contra bots.

## Para curiosos

`index.html` es todo el juego en un único archivo. El código legible está en `src/` y las pruebas en `test/`.
Las jugadas viajan cifradas por servidores públicos y gratuitos de mensajería (MQTT); no hay servidor propio.
