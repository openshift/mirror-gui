import './setup.js';
import request from 'supertest';
import { ensureTestDirs } from './setup.js';
import { app } from '../../../server/index.js';

export async function getTestApp() {
  await ensureTestDirs();
  return request(app);
}
