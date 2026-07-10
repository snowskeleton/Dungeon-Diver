import { type } from "@colyseus/schema";
import { AiState } from "shared";
import { EntityState } from "./EntityState";

export class EnemyState extends EntityState {
  @type("string") aiState: AiState = "patrol";
  @type("string") targetId: string = "";
  @type("string") facing: string = "right";
  @type("boolean") isDying: boolean = false;
  @type("boolean") stunned: boolean = false;
  @type("string") enemyType: string = "";
}
