## Current Architecture

The application currently uses the following stack:

- Frontend: React with Vite

- Backend: Node.js with Express

- Database / Backend Platform: Supabase

Containerisation: Docker

Local orchestration: Docker Compose

### High-Level View

User Browser
|
| HTTP
v
React Frontend
localhost:5173
|
| REST / JSON
v
Express Backend
localhost:3000
|
| HTTPS
v
Supabase Cloud

The React and Express applications run locally in Docker containers. Supabase is hosted externally and is not containerised as part of the local Docker Compose setup.

ConnectSphere/
|
|-- frontend/
| |-- src/
| |-- public/
| |-- Dockerfile
| |-- .dockerignore
| |-- package.json
| `-- vite.config.js
|
|-- backend/
|   |-- src/
|   |   |-- server.js
|   |   `-- supabase.js
| |-- Dockerfile
| |-- .dockerignore
| |-- package.json
| `-- package-lock.json
|
|-- docker-compose.yml
|-- .env
|-- .env.example
|-- .gitignore
|-- architecture.md
