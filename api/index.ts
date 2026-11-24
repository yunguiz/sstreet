import app from '../server.js';
import { blingRouter } from '../server-bling.js';

// Garante que o router /api/bling esteja explicitamente montado no handler principal da Vercel
app.use('/api/bling', blingRouter);

export default app;
