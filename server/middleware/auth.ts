import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';

const JWT_SECRET = process.env.JWT_SECRET || 'chhath-puja-samiti-super-secret-jwt-key-2026';

export interface AuthenticatedRequest extends Request {
  adminUser?: { role: string; loggedInAt: number };
}

export function generateAdminToken(): string {
  return jwt.sign(
    { role: 'admin', loggedInAt: Date.now() },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

export function requireAdminAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  // Check httpOnly cookie first, then fallback to Authorization header
  const token = req.cookies?.cps_auth || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);

  if (!token) {
    res.status(401).json({ error: 'Unauthorized: Admin authentication required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { role: string; loggedInAt: number };
    req.adminUser = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized: Invalid or expired session' });
  }
}

// 5 tries per 10 minutes for Admin Login
export const loginRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait 10 minutes and try again.' },
});

// General API Rate Limiter
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
