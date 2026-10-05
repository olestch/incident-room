import { z } from 'zod';
const email = z.email('Enter a valid email address.').transform((value) => value.toLowerCase());
export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.').max(128),
});
export const registrationSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter your display name.').max(80),
    email,
    password: z.string().min(10, 'Use at least 10 characters.').max(128),
    confirmation: z.string(),
  })
  .refine((value) => value.password === value.confirmation, {
    path: ['confirmation'],
    message: 'Passwords must match.',
  });
export const resetSchema = z.object({ email });
