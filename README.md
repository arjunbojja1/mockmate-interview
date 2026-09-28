# MockMate

A lightweight mock-interview tool: pick a role (interviewer or candidate), share a room code, and get a live shared code editor, video chat, timer, and chat — all client-side, no backend required (uses [PeerJS](https://peerjs.com/) for WebRTC signaling).

## Usage

1. Open the site, choose **I'm an Interviewer** to generate a room code, or **I'm a Candidate** to join one.
2. Share the room code with your practice partner.
3. Code together in real time, hop on video, and run JavaScript snippets directly in the browser.

## Notes

- Video/data sync relies on PeerJS's public cloud signaling server (free tier) — fine for casual practice sessions, not production use.
- Only JavaScript execution is sandboxed and runnable in-browser; other languages are editable but not executed.
- Nothing is persisted server-side — closing the tab ends the session.
