import axios, { AxiosInstance } from 'axios';
import Constants from 'expo-constants';

import { ApiResponse, Listing } from '../types';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;

function resolveBaseUrl(): string {
  if (__DEV__) {
    return extra.apiUrlDev || 'http://localhost:8000';
  }
  return extra.apiUrl || 'https://shivarya.dev/ps5_tracker';
}

class ApiService {
  private api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: resolveBaseUrl(),
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async getStatus() {
    const res = await this.api.get<ApiResponse<Listing[]>>('/status');
    return res.data;
  }

  async registerDevice(expoPushToken: string, deviceLabel?: string) {
    const res = await this.api.post<ApiResponse<null>>('/devices/register', {
      expoPushToken,
      deviceLabel,
    });
    return res.data;
  }
}

export default new ApiService();
export { resolveBaseUrl };
