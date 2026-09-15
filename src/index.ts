import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { initDb } from './db';
import routes from './routes';
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', routes);
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});
initDb();
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
