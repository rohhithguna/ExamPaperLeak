import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) {
    console.error('FATAL ERROR: JWT_SECRET environment variable is missing.');
    process.exit(1);
}
export interface AuthRequest extends Request {
  user?: {
    id: number;
    username?: string;
    name?: string;
    role: string;
    status: string;
  };
}
export function generateToken(user: any) {
  return jwt.sign(
    { id: user.id, name: user.name, role: user.role, status: user.status },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}
export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded as any;
    next();
  } catch (err) {
    const { logAudit } = require('./db');
    logAudit('UNAUTHORIZED_ACCESS_ATTEMPT', null, 'INVALID_TOKEN').catch(console.error);
    return res.status(401).json({ error: 'Failed to authenticate token' });
  }
}
export function requireRole(role: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || req.user.role !== role) {
      const { logAudit } = require('./db');
      logAudit('UNAUTHORIZED_ACCESS_ATTEMPT', req.user?.id || null, `REQUIRED_ROLE_${role}`).catch(console.error);
      return res.status(403).json({ error: `Requires ${role} role` });
    }
    next();
  };
}
