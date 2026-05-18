import { z } from 'zod';

export const CAIP2_DB_RE = /^[-a-z0-9]{3,8}:[-_.a-zA-Z0-9]{1,32}$/;
export const Caip2Schema = z.string().regex(CAIP2_DB_RE, 'Must be a valid CAIP-2 ID (namespace:reference)');
