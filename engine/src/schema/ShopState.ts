import { Observable, ObservableMap, ObservableList, tracked } from "shared";
import { ShopStateView, ShopItemStateView } from "shared";

// One purchasable weapon sitting on a pedestal in a shop room. x/y are the
// pedestal's world position so clients render it in place; `purchased` flips
// (shared team pool) once anyone buys it.
export class ShopItemState extends Observable implements ShopItemStateView {
  @tracked("string") weaponId: string = "";
  @tracked("uint8") cost: number = 0;
  @tracked("boolean") purchased: boolean = false;
  @tracked("number") x: number = 0;
  @tracked("number") y: number = 0;
}

// A shop's contents, keyed in GameState.shops by the room id ("gx,gy").
export class ShopState extends Observable implements ShopStateView {
  @tracked("string") roomId: string = "";
  @tracked([ShopItemState]) items = new ObservableList<ShopItemState>();
}
