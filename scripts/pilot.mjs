// `npm run pilot`: the whole team backend on one machine, as pilot testers run it.
// The UI (Vite), the app server with APP_BACKEND=team, and the worker, sharing a bucket
// folder in the app data folder (%LOCALAPPDATA%\MonoRail-Metadata\team-bucket on Windows).
// The worker is the job that runs on Vertex AI in a Google Cloud setup; here it runs locally,
// next to the OpenMetadata in deploy/openmetadata. See README.md, "Pilot".
import 'dotenv/config'
import concurrently from 'concurrently'

if (!process.env.OM_URL) {
  console.error(
    [
      'The pilot runs the worker on this machine, and the worker needs an OpenMetadata to talk to.',
      '  1. Start OpenMetadata:  cd deploy/openmetadata && docker compose up -d   (deploy/openmetadata/README.md)',
      '  2. In .env, set OM_URL=http://localhost:8585 and OM_TOKEN, or OM_EMAIL and OM_PASSWORD.',
      '  3. Optionally fill it with the sample catalog: npm run seed:om',
      'See README.md, "Pilot".',
    ].join('\n'),
  )
  process.exit(1)
}

const { result } = concurrently(
  [
    { name: 'web', command: 'vite', prefixColor: 'cyan' },
    { name: 'api', command: 'node --watch --import tsx server/index.ts', prefixColor: 'magenta', env: { APP_BACKEND: 'team' } },
    { name: 'worker', command: 'npm run worker', prefixColor: 'yellow' },
  ],
  { killOthersOn: ['failure', 'success'] },
)

result.then(
  () => process.exit(0),
  () => process.exit(1),
)
