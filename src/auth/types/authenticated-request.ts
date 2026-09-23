import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user: {
    userId: string;
    email: string;
  };
}

// El payload del refresh token solo trae sub (userId), sin email.
export interface RefreshAuthenticatedRequest extends Request {
  user: {
    userId: string;
  };
}

// Para endpoints con OptionalJwtAuthGuard: user puede venir undefined si no
// hay sesión.
export interface OptionalAuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
  };
}
