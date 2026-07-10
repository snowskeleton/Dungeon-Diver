import { Schema, type } from "@colyseus/schema";

export class EntityState extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") health: number = 100;
  @type("number") speedMultiplier: number = 1;
}
