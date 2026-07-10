import { Schema, ArraySchema, type } from "@colyseus/schema";

// One purchasable weapon sitting on a pedestal in a shop room. x/y are the
// pedestal's world position so clients render it in place; `purchased` flips
// (shared team pool) once anyone buys it.
export class ShopItemState extends Schema {
  @type("string") weaponId: string = "";
  @type("uint8") cost: number = 0;
  @type("boolean") purchased: boolean = false;
  @type("number") x: number = 0;
  @type("number") y: number = 0;
}

// A shop's contents, keyed in GameState.shops by the room id ("gx,gy").
export class ShopState extends Schema {
  @type("string") roomId: string = "";
  @type([ShopItemState]) items = new ArraySchema<ShopItemState>();
}
