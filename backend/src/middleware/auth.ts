import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtHeader, type JwtPayload } from "jsonwebtoken";
import jwksRsa from "jwks-rsa";

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  tenantId: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

const MSA_CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";

export function createEntraAuthMiddleware(options: {
  clientId: string;
  tenantId: string;
}) {
  const jwksClient = jwksRsa({
    jwksUri: "https://login.microsoftonline.com/common/discovery/v2.0/keys",
    cache: true,
    cacheMaxEntries: 10,
    cacheMaxAge: 600_000,
    rateLimit: true,
    jwksRequestsPerMinute: 10,
  });

  const allowedIssuers = new Set([
    `https://login.microsoftonline.com/${options.tenantId}/v2.0`,
    `https://login.microsoftonline.com/${MSA_CONSUMER_TENANT_ID}/v2.0`,
  ]);

  const getKey = (
    header: JwtHeader,
    callback: (err: Error | null, key?: string) => void
  ) => {
    if (!header.kid) {
      return callback(new Error("Missing kid in JWT header"));
    }
    jwksClient.getSigningKey(header.kid, (err, key) => {
      if (err) return callback(err);
      callback(null, key?.getPublicKey());
    });
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }

    const token = authHeader.slice("Bearer ".length).trim();

    jwt.verify(
      token,
      getKey,
      {
        audience: [options.clientId, `api://${options.clientId}`],
        algorithms: ["RS256"],
      },
      (err, decoded) => {
        if (err || !decoded || typeof decoded === "string") {
          res.status(401).json({
            error: "Invalid or expired Microsoft Entra ID token",
            detail: err?.message,
          });
          return;
        }

        const payload = decoded as JwtPayload;
        if (!payload.iss || !allowedIssuers.has(payload.iss)) {
          res.status(401).json({ error: "Token issuer is not trusted" });
          return;
        }

        req.user = {
          id: String(payload.oid ?? payload.sub ?? "unknown"),
          name: String(payload.name ?? payload.preferred_username ?? "Student"),
          email: String(payload.preferred_username ?? payload.email ?? ""),
          tenantId: String(payload.tid ?? ""),
        };
        next();
      }
    );
  };
}
