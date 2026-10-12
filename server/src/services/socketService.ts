import { Server as SocketIOServer } from 'socket.io';

let io: SocketIOServer | null = null;

export function setSocketIO(instance: SocketIOServer) {
  io = instance;
}

export function getSocketIO(): SocketIOServer | null {
  return io;
}

export function broadcastEvent(event: string, data: any) {
  if (io) {
    io.emit(event, data);
  }
}
