import 'dotenv/config';

type Config = {
  port: number;
  corsOrigin: string;
  databaseUrl: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  accessTokenTtl: string;
  refreshTokenTtl: string;
  openaiApiKey?: string;
  openaiModel?: string;
  s3Region?: string;
  s3Bucket?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing env var ${name}`);
  }
  return v;
}

export function getConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 4000),
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    databaseUrl: requireEnv('DATABASE_URL'),
    jwtAccessSecret: requireEnv('JWT_ACCESS_SECRET'),
    jwtRefreshSecret: requireEnv('JWT_REFRESH_SECRET'),
    accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
    refreshTokenTtl: process.env.REFRESH_TOKEN_TTL ?? '30d',
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL,
    s3Region: process.env.S3_REGION,
    s3Bucket: process.env.S3_BUCKET,
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}
