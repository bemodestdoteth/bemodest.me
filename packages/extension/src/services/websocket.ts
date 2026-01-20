import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '../shared/constants';

/**
 * @class WebSocketService
 * @desc Manages Socket.IO connection for real-time communication with the server
 */
export class WebSocketService {
    private socket: Socket | null = null;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5;
    private readonly RECONNECT_DELAY_MS: number = 5000;

    /**
     * @name connect
     * @desc Establishes Socket.IO connection to the server
     * @param {string} token - JWT token for authentication
     * @returns {Promise<Socket>}
     * @throws {Error} If connection fails
     */
    async connect(token: string): Promise<Socket> {
        if (this.socket?.connected) {
            console.log('[WebSocket] Already connected');
            return this.socket;
        }

        return new Promise((resolve, reject) => {
            try {
                this.socket = io(API_BASE_URL, {
                    auth: { token },
                    reconnectionDelayMax: 10000,
                    transports: ['websocket', 'polling']
                });

                this.socket.on('connect', () => {
                    console.log('[WebSocket] Connected successfully');
                    this.reconnectAttempts = 0;
                    resolve(this.socket!);
                });

                this.socket.on('connect_error', (error: Error) => {
                    console.error('[WebSocket] Connection error:', error.message);
                    this.handleReconnect(token);
                    reject(error);
                });

                this.socket.on('disconnect', (reason: string) => {
                    console.warn('[WebSocket] Disconnected:', reason);
                    if (reason === 'io server disconnect') {
                        this.handleReconnect(token);
                    }
                });

                this.socket.on('error', (error: Error) => {
                    console.error('[WebSocket] Socket error:', error.message);
                });

            } catch (error) {
                console.error('[WebSocket] Failed to create socket:', error);
                reject(error);
            }
        });
    }

    /**
     * @name handleReconnect
     * @desc Handles reconnection logic with exponential backoff
     * @param {string} token - JWT token for authentication
     * @returns {void}
     */
    private handleReconnect(token: string): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[WebSocket] Max reconnection attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1);
        
        console.log(`[WebSocket] Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
        
        setTimeout(() => {
            this.connect(token).catch(console.error);
        }, delay);
    }

    /**
     * @name getSocket
     * @desc Returns the current socket instance
     * @returns {Socket | null}
     */
    getSocket(): Socket | null {
        return this.socket;
    }

    /**
     * @name emit
     * @desc Emits an event to the server
     * @param {string} event - Event name
     * @param {any} payload - Event payload
     * @returns {void}
     */
    emit(event: string, payload: any): void {
        if (!this.socket?.connected) {
            console.error('[WebSocket] Cannot emit - not connected');
            return;
        }
        this.socket.emit(event, payload);
    }

    /**
     * @name on
     * @desc Registers an event listener
     * @param {string} event - Event name
     * @param {Function} callback - Event callback
     * @returns {void}
     */
    on(event: string, callback: (...args: any[]) => void): void {
        if (!this.socket) {
            console.error('[WebSocket] Cannot register listener - socket not initialized');
            return;
        }
        this.socket.on(event, callback);
    }

    /**
     * @name off
     * @desc Removes an event listener
     * @param {string} event - Event name
     * @param {Function} callback - Event callback
     * @returns {void}
     */
    off(event: string, callback?: (...args: any[]) => void): void {
        if (!this.socket) {
            console.error('[WebSocket] Cannot remove listener - socket not initialized');
            return;
        }
        this.socket.off(event, callback);
    }

    /**
     * @name disconnect
     * @desc Disconnects from the server
     * @returns {void}
     */
    disconnect(): void {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            console.log('[WebSocket] Disconnected');
        }
    }

    /**
     * @name isConnected
     * @desc Checks if the socket is connected
     * @returns {boolean}
     */
    isConnected(): boolean {
        return this.socket?.connected ?? false;
    }
}

// Singleton instance
export const websocketService = new WebSocketService();
