# INFORME TÉCNICO — LAN Fighter

## 1. Descripción General

Juego de peleas 2D para 2 jugadores en red local (LAN). Cliente-servidor vía WebSocket. Un jugador ejecuta el servidor y ambos se conectan desde el navegador.

**Stack tecnológico:**
- Servidor: Node.js + librería `ws` (WebSocket)
- Cliente: HTML5 + Canvas 2D + JavaScript vanilla
- Transporte: WebSocket (ws://)
- Frame rate: 60 FPS fijos (setInterval del lado del servidor)

---

## 2. Arquitectura Cliente-Servidor

```
[ Navegador P1 ] ←→ [ Servidor Node.js (puerto 3000) ] ←→ [ Navegador P2 ]
```

### Servidor (`server.js`)
- Sirve el archivo `public/index.html` en HTTP
- Maneja conexiones WebSocket, lobby de 2 jugadores
- Ejecuta el game loop a 60 FPS
- Procesa inputs, detecta colisiones, actualiza estado
- Transmite el estado a ambos clientes ~60 veces/segundo

### Cliente (`public/index.html`)
- Canvas 2D para renderizado de personajes, efectos, fireballs
- HUD en HTML/CSS (barras de vida, poder, rondas)
- Captura inputs de teclado y táctiles (botones en pantalla)
- Envía inputs al servidor a 60 FPS

---

## 3. Protocolo de Red

### Cliente → Servidor

| Tipo | Propósito | Formato |
|------|-----------|---------|
| `select` | Elegir personaje | `{type:'select', character:'warrior'}` |
| `input` | Inputs del jugador | `{type:'input', keys:{left,bool, right:bool, jump:bool, punch:bool, kick:bool, dodge:bool, fireball:bool}}` |
| `special` | Activar habilidad especial | `{type:'special'}` |

### Servidor → Cliente

| Tipo | Propósito | Formato |
|------|-----------|---------|
| `init` | Asignar ID y personajes disponibles | `{type:'init', playerId:int, characters:[{id,name,color}]}` |
| `start` | Inicio de la partida | `{type:'start', characters:[id,id]}` |
| `state` | Estado actual del juego | `{type:'state', players:[{...}], fireballs:[], effects:[], roundState, roundTimer, round, scores}` |
| `ko` | Knockout | `{type:'ko', winner:int}` |
| `gameover` | Fin del juego (alguien ganó 2 rondas) | `{type:'gameover', winner:int, scores:[int,int]}` |
| `waiting` | Esperando oponente | `{type:'waiting'}` |
| `error` | Error (ej. sala llena) | `{type:'error', message:string}` |

### Estado del jugador (broadcast)

```json
{
  "x": 200, "y": 350,            // posición
  "health": 250, "maxHealth": 300, // vida actual / máxima
  "facing": 1,                     // 1 = derecha, -1 = izquierda
  "attackTimer": 0, "attackType": null,
  "hitTimer": 0,                   // frames restantes de hit stun
  "grounded": true,
  "dodgeTimer": 0, "dodgeCooldown": 0,
  "specialTimer": 0, "specialActivated": 0,
  "power": 75,                     // barra de poder (0-100)
  "charId": "warrior"
}
```

---

## 4. Game Loop

Frecuencia: **60 FPS** (setInterval de 16.67ms)

Secuencia por frame (`gameTick`):

1. **Countdown** → espera 3 segundos
2. **Fighting** → para cada jugador:
   - Decrementar cooldowns (dodge, special, specialActivated)
   - Procesar ataques (punch/kick) si attackTimer === 0
   - Detectar colisiones de ataque → aplicar daño, knockback, power
   - Procesar movimiento (si no está en hit stun, dodge o shield)
   - Procesar dodge (edge-triggered, 5s cooldown)
   - Procesar fireball (edge-triggered, cuesta 100% power)
   - Decrementar timers (attack, special, dodge)
   - Aplicar gravedad, mover, resolver colisiones con bordes y suelo
3. **Resolver overlap** entre jugadores
4. **Mover fireballs**, detectar colisiones con el oponente
5. **Limpiar efectos** caducados
6. **Broadcast** del estado a ambos clientes

---

## 5. Personajes

### Guerrero

| Atributo | Valor |
|----------|-------|
| Vida | 300 |
| Velocidad movimiento | 4.5 px/frame |
| Velocidad salto | -12 px/frame |
| Golpe (J) | 12 daño, alcance 22, cd 46 (1.3 golpes/s) |
| Patada (K) | 20 daño, alcance 42, cd 46 |
| Esquiva (X) | velocidad 13, duración 10, cd 300 frames (5s) |
| Especial (L) | **Escudo** — 1.5s de invencibilidad, no puede moverse |

### Ninja

| Atributo | Valor |
|----------|-------|
| Vida | 240 |
| Velocidad movimiento | 5.5 px/frame |
| Velocidad salto | -14 px/frame |
| Golpe (J) | 5 daño, alcance 18, cd 20 (3 golpes/s) |
| Patada (K) | 9 daño, alcance 35, cd 20 |
| Esquiva (X) | velocidad 16, duración 8, cd 240 frames (4s) |
| Especial (L) | **Teletransportación** — aparece detrás del oponente |

### Bruto

| Atributo | Valor |
|----------|-------|
| Vida | 400 |
| Velocidad movimiento | 3.0 px/frame |
| Velocidad salto | -9 px/frame |
| Golpe (J) | 23 daño, alcance 26, cd 60 (1 golpe/s) |
| Patada (K) | 34 daño, alcance 48, cd 60 |
| Esquiva (X) | velocidad 9, duración 12, cd 360 frames (6s) |
| Especial (L) | **Golpe de tierra** — 18 daño si está cerca, efecto visual siempre |

---

## 6. Sistema de Poder

La barra de poder (0–100) se usa como recurso compartido para dos habilidades:

| Acción | Costo | Ganancia |
|--------|-------|----------|
| Golpear al oponente | — | +15 |
| Recibir golpe | — | +8 |
| Fireball (F) | 100% | — |
| Especial (L) | 50% | — |

Al alcanzar 50 de poder se habilita el botón **ESP [L]**.
Al alcanzar 100 de poder se habilita también **FUEGO [F]**.

---

## 7. Fireball

- Tecla **F** (o botón táctil), edge-triggered
- Cuesta **100%** de la barra de poder
- Velocidad: 9 px/frame
- Daño: 25
- Tamaño: 18x18 px
- Duración máxima: 120 frames (2 segundos)
- Se destruye al impactar o salir del escenario

---

## 8. Esquiva

- Tecla **X** (o botón táctil), edge-triggered
- Dash en la dirección que mira el personaje
- **Frames de invencibilidad** durante la duración de la esquiva
- Cooldown por personaje: Guerrero 5s, Ninja 4s, Bruto 6s

---

## 9. Habilidades Especiales

Se activan con **L** o botón **ESP [L]**. Cuestan 50% de poder.

### Guerrero — Escudo
- 90 frames (1.5s) de invencibilidad total
- No puede moverse ni atacar mientras dura
- Efecto visual: aura circular púrpura

### Ninja — Teletransportación
- Aparece instantáneamente detrás del oponente
- Invierte su facing
- Efecto visual: destellos en posición original y destino

### Bruto — Golpe de Tierra
- Siempre muestra el efecto visual de impacto en el suelo
- Si el oponente está a menos de 100px: 18 daño + knockback
- Efecto visual: líneas de impacto quebradas en el suelo

---

## 10. HUD (Heads-Up Display)

```
┌─────────────────────┬──────┬──────────────────┐
│ P1 [Guerrero]       │ R1   │  [Bruto] P2      │
│ ████████████░░░░░░░ │ 0-0  │ ██████████░░░░░░  │  <- Barras de vida
│ ███████████████████ │      │ ████████████████  │  <- (2 por jugador)
│ ██████████░░░░░░░░░ │      │ ██████░░░░░░░░░░  │  <- Barra de poder
└─────────────────────┴──────┴──────────────────┘
```

Cada jugador tiene **2 barras de vida** (cada una representa el 50% de la vida total). Cuando la vida baja del 50%, la barra superior se vacía y la inferior comienza a decrecer.

La barra de poder es más delgada, color amarillo (se vuelve roja al 100%).

---

## 11. Sistema de Combate

### Detección de Golpes
- AABB (Axis-Aligned Bounding Box) collision
- El ataque crea una hitbox que se extiende desde el personaje en la dirección que mira
- El golpe acierta en el frame `cd - 2` (2 frames después de iniciar el ataque)

### Hit Stun
- Al recibir daño, el personaje entra en hit stun (8–14 frames)
- Durante hit stun: no puede moverse, pero **puede atacar**
- Se aplica knockback (velocidad horizontal + vertical)

### Invencibilidad
- Durante la **esquiva**: invencible
- Durante el **escudo** (Guerrero): invencible

### Mecánicas
- Los personajes no pueden atravesarse (overlap prevention)
- Caída libre con gravedad (0.6 px/frame²)
- El facing se actualiza según la dirección de movimiento

---

## 12. Formato de Partida

- **Mejor de 3 rondas** (el primero en ganar 2 rondas gana la partida)
- Cada ronda comienza con countdown de 3 segundos
- Al hacer KO, el ganador suma un punto
- Al llegar a 2 puntos: pantalla de game over y vuelta a selección

---

## 13. Instalación y Ejecución

```bash
# Instalar dependencias
npm install

# Iniciar servidor
node server.js

# Abrir en el navegador
# http://localhost:3000
# El otro jugador se conecta con la IP local del servidor
```

**Requisitos:** Node.js 18+ (probado en Node.js 24)

**Dependencias:** `ws` (WebSocket server)

---

## 14. Controles

| Tecla | Acción |
|-------|--------|
| A / ← | Moverse izquierda |
| D / → | Moverse derecha |
| W / ↑ | Saltar |
| J | Golpe (puñetazo) |
| K | Patada |
| X | Esquivar |
| F | Fireball (cuesta 100% poder) |
| L | Habilidad especial (cuesta 50% poder) |

En dispositivos táctiles hay botones en pantalla.

---

## 15. Constantes del Juego

| Constante | Valor | Descripción |
|-----------|-------|-------------|
| WIDTH | 900 | Ancho del escenario (px) |
| HEIGHT | 500 | Alto del escenario (px) |
| GROUND_Y | 420 | Posición Y del suelo |
| GRAVITY | 0.6 | Gravedad por frame |
| PLAYER_W | 50 | Ancho del personaje (px) |
| PLAYER_H | 70 | Alto del personaje (px) |
| MAX_POWER | 100 | Máximo de la barra de poder |
| POWER_ON_HIT | 15 | Poder ganado al golpear |
| POWER_ON_HIT_RECEIVED | 8 | Poder ganado al recibir golpe |
| FIREBALL_SPEED | 9 | Velocidad del fireball |
| FIREBALL_DMG | 25 | Daño del fireball |
| FIREBALL_SIZE | 18 | Tamaño del fireball |
| FIREBALL_LIFETIME | 120 | Duración máxima del fireball (frames) |
| PORT | 3000 | Puerto del servidor |

---

## 16. Archivos del Proyecto

| Archivo | Propósito |
|---------|-----------|
| `server.js` | Servidor Node.js, lógica del juego, game loop |
| `public/index.html` | Cliente: canvas, HUD, inputs, renderizado |
| `package.json` | Dependencias y configuración npm |
| `INFORME_TECNICO.md` | Este documento |

---

## 17. Diagrama de Flujo

```
CONEXIÓN
  │
  ├─ Jugador 1 conecta → playerId = 0
  ├─ Jugador 2 conecta → playerId = 1
  │
  ▼
SELECCIÓN DE PERSONAJE
  │
  ├─ Cada jugador envía {type:'select', character}
  ├─ Cuando ambos listos → {type:'start'}
  │
  ▼
INICIO DE RONDA
  │
  ├─ Countdown 3s
  │
  ▼
  ┌──────────────────────────────────────┐
  │  GAME LOOP (60 FPS)                  │
  │                                      │
  │  1. Leer inputs de cada jugador      │
  │  2. Procesar ataques                 │
  │  3. Aplicar físicas (gravedad, mvto) │
  │  4. Actualizar fireballs             │
  │  5. Detectar colisiones              │
  │  6. Broadcast estado                 │
  └──────────────────────────────────────┘
  │
  ▼
KO (vida de un jugador = 0)
  │
  ├─ Mostrar KO, sumar punto
  ├─ Si alguien tiene 2 puntos → GAMEOVER
  └─ Sino → siguiente ronda
```

---

*Documento generado el 14 de mayo de 2026.*
