import { z } from 'zod';

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1).optional(),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const LogoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export const UpdateMeSchema = z.object({
  name: z.string().min(1),
});

export const ChangePasswordSchema = z
  .object({
    oldPassword: z.string().min(1),
    newPassword: z.string().min(6),
    confirmNewPassword: z.string().min(6),
  })
  .superRefine((v, ctx) => {
    if (v.newPassword !== v.confirmNewPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Passwords do not match', path: ['confirmNewPassword'] });
    }
  });

export const CreateGoalSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  progressPct: z.number().int().min(0).max(100).optional(),
  dueAt: z.string().datetime().optional(),
});

export const UpdateGoalSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  progressPct: z.number().int().min(0).max(100).optional(),
  dueAt: z.string().datetime().optional().nullable(),
  completed: z.boolean().optional(),
});

export const CreateEventSchema = z.object({
  title: z.string().min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional(),
  repeat: z.string().min(1).optional(),
  seriesEndAt: z.string().datetime().optional(),
});

export const ListRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const UpdateEventSchema = z.object({
  title: z.string().min(1).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional().nullable(),
  repeat: z.string().min(1).optional().nullable(),
});

export const LeaderboardFieldQuerySchema = z.object({
  field: z.enum(['Sport', 'Academy', 'Entertainment']),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const AiGoalSuggestSchema = z.object({
  prompt: z.string().min(1),
  deadline: z.string().min(1).optional(),
  intensity: z.enum(['Light', 'Normal', 'Hard']).optional(),
});
