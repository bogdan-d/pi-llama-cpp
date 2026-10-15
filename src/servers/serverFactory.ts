import { Server } from "../server";
import type {
  ServerOptions,
  ServerSettingsResolver,
} from "../interfaces/server";

export class ServerFactory {
  create(resolver: ServerSettingsResolver, options: ServerOptions): Server {
    return new Server(resolver, options);
  }
}
