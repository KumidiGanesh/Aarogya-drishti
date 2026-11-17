import { io } from 'socket.io-client';
import api from './api.js';
import { getAccessToken } from './tokenStore.js';

export function createSignalingSocket() {
  const socketUrl = import.meta.env.VITE_SOCKET_URL || api.defaults.baseURL;
  const socketOrigin = new URL(socketUrl, window.location.href).origin;
  return io(socketOrigin, {
    autoConnect: false,
    auth: (callback) => callback({ token: getAccessToken() }),
    reconnection: true,
    reconnectionAttempts: Infinity,
    timeout: 10_000,
  });
}

export function emitSignal(socket, event, payload) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(Object.assign(new Error('Signaling connection is offline'), { code: 'OFFLINE' }));
      return;
    }

    socket.timeout(10_000).emit(event, payload, (timeoutError, response) => {
      if (timeoutError) {
        reject(Object.assign(new Error('Signaling request timed out'), { code: 'TIMEOUT' }));
        return;
      }
      if (!response?.success) {
        reject(
          Object.assign(new Error(response?.message || 'Signaling request failed'), {
            code: response?.code || 'SIGNALING_ERROR',
          }),
        );
        return;
      }
      resolve(response.data);
    });
  });
}
