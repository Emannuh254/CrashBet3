## Packages
howler | Sound effects for game events (engine, crash, win)
canvas-confetti | Celebration effect on successful cashout
date-fns | Formatting timestamps in history

## Notes
- Expecting WebSocket to be available at `/ws` relative to the current host.
- Auth tokens are expected to be handled via HTTP-only cookies (`credentials: 'include'`).
- The game uses a continuous `requestAnimationFrame` loop for smooth canvas rendering of the plane curve.
- Money values are expected in cents from the backend and are formatted to dollars on the frontend.
