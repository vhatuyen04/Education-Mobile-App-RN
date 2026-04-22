import { createServer } from './serverFactory.js';

const { app, config } = createServer();

app.listen(config.port);
