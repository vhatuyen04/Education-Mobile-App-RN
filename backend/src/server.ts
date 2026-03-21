import { createServer } from './serverFactory.js';

const { app, config } = createServer();

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
