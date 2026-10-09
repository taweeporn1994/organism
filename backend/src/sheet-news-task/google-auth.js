import { GoogleAuth, OAuth2Client } from 'google-auth-library';

const scopes = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
];
let clientPromise;

async function createClient() {
  const mode = process.env.GOOGLE_AUTH_MODE || 'service-account';
  if (mode === 'service-account') {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      throw new Error('AUTH_CONFIG: GOOGLE_APPLICATION_CREDENTIALS must point to your service account JSON');
    }
    return new GoogleAuth({ scopes, keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS }).getClient();
  }
  if (mode === 'oauth') {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
      throw new Error('AUTH_CONFIG: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN are required');
    }
    const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
    return client;
  }
  throw new Error('AUTH_CONFIG: GOOGLE_AUTH_MODE must be service-account or oauth');
}

/** Separate auth module. Google library refreshes expiring access tokens. */
export async function getGoogleAccessToken() {
  clientPromise ??= createClient().catch(error => { clientPromise = undefined; throw error; });
  const client = await clientPromise;
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('AUTH_FAILED: Google did not return an access token');
  return token;
}
