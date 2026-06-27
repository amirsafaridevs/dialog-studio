/**
 * WordPress API Client for Dialog Studio
 */

import { getDtmConfig } from './dtmConfig.js';

export class ApiClient {
  constructor() {
    const config = getDtmConfig();
    this.baseUrl = config.apiBase;
    this.settingsNonce = config.settingsNonce;
  }

  async request(method, endpoint, data = null, options = {}) {
    let url = `${this.baseUrl}${endpoint}`;

    const fetchOptions = {
      method: method.toUpperCase(),
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-DTM-Nonce': this.settingsNonce,
        ...options.headers
      },
      signal: options.signal,
    };

    if (data && ['POST', 'PUT', 'PATCH'].includes(fetchOptions.method)) {
      fetchOptions.body = JSON.stringify(data);
    } else if (data && fetchOptions.method === 'GET') {
      const params = new URLSearchParams(data);
      const separator = url.includes('?') ? '&' : '?';
      url += separator + params.toString();
    }

    try {
      const response = await fetch(url, fetchOptions);
      
      if (!response.ok) {
        let serverMessage = '';
        const contentType = response.headers.get('content-type');

        if (contentType && contentType.includes('application/json')) {
          try {
            const errorPayload = await response.json();
            if (typeof errorPayload?.error === 'string' && errorPayload.error.trim() !== '') {
              serverMessage = errorPayload.error.trim();
            }
          } catch {
            // Fall back to status text below.
          }
        }

        throw new Error(
          serverMessage || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      } else {
        return await response.text();
      }
      
    } catch (error) {
      console.error(`[ApiClient] ${method} ${endpoint} failed:`, error);
      throw error;
    }
  }

  async get(endpoint, params = null, options = {}) {
    return await this.request('GET', endpoint, params, options);
  }

  async post(endpoint, data = null, options = {}) {
    return await this.request('POST', endpoint, data, options);
  }

  async put(endpoint, data = null, options = {}) {
    return await this.request('PUT', endpoint, data, options);
  }

  async delete(endpoint, data = null, options = {}) {
    return await this.request('DELETE', endpoint, data, options);
  }

  async patch(endpoint, data = null, options = {}) {
    return await this.request('PATCH', endpoint, data, options);
  }

  // Health check
  async healthCheck(options = {}) {
    try {
      const response = await this.get('/settings', null, options);
      return {
        healthy: response.success === true,
        message: response.success ? 'API connection healthy' : 'API returned error response'
      };
    } catch (error) {
      return {
        healthy: false,
        message: `API connection failed: ${error.message}`
      };
    }
  }
}

export default ApiClient;