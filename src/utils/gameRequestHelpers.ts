import { RoomCard, type ItemCard, type LootCard, type MonsterCard } from "@/models/cards";
import { Player } from "@/models/entities/player";
import type { Game } from "@/models/game";
import { GameError } from "@/models/GameError";
import { TargetBuilder } from "@/models/targetBuilder";
import type { Requests, TargetSelectorResponse } from "@/shared/api";
import { toSerializedTranslation } from "./translation";
import { DiceRoll } from "@/models/stackElement";

export async function executeAttackMonsterRequest(
  game: Game,
  payload: Requests.AttackMonster,
  player: Player,
): Promise<void> {
  const monster =
    payload.card === "top" ? "topDeck" : game.attackableEntities.find(e => e.card.globalId === payload.card.globalId);

  if (!monster) {
    throw new GameError(`No monster at index ${payload.card}`,
      toSerializedTranslation("error.noMonsterAtIndex", { value: payload.card })
    );
  }

  const drawInIndex = payload.card === "top" ? payload.toCoverIndex : -1;
  await game.actions.declareAttackOnEntity(player, monster, drawInIndex);
  game.addToHistory({
    type: "AttackMonster",
    payload,
    issuer: player.id,  
  });
}

export async function executeActivateRequest(
  game: Game,
  payload: Requests.Activate,
  player: Player,
): Promise<TargetSelectorResponse> {
  const card = TargetBuilder.getCard(game, player, payload.index, payload.type);
  // const { effectId, choice } = card.getEffectIdAndChooseOneChoiceFromSeparatorId(payload.effectIndex);

  let partialChoices = payload.targetChoices === undefined ? [] : payload.targetChoices;
  // if(choice !== undefined) {
  //   partialChoices = [...TargetBuilder.convertToSelectionItems(choice), ...partialChoices];
  // }
  const choices: TargetSelectorResponse = TargetBuilder.getNextSelector(
    game,
    player,
    card,
    partialChoices,
    payload.effectIndex,
  );

  if (choices.complete) {
    const targets = TargetBuilder.buildTargets(
      game,
      player,
      card,
      partialChoices,
      payload.effectIndex,
    );
    await game.actions.useCard(
      payload.type,
      player,
      payload.index,
      targets,
      payload.effectIndex,
    );
  }
  if (choices.complete) {
    game.addToHistory({
      type: "Activate",
      payload,
      issuer: player.id,
    });
  }
  return choices;
}

export async function executeActivateWithIdRequest(
  game: Game,
  payload: Requests.ActivateWithID,
  player: Player,
): Promise<TargetSelectorResponse> {
  const card = TargetBuilder.getCard(game, player, payload.index, payload.type);
  const { effectId, choice } = card.getEffectIdAndChooseOneChoiceFromSeparatorId(payload.effectIndex);

  let partialChoices = payload.targetChoices === undefined ? [] : payload.targetChoices;
  if(choice !== undefined) {
    partialChoices = [...choice.map(c=>{return {type: "chooseOne" as const, payload: c}}), ...partialChoices];
  }
  const payloadActivate: Requests.Activate = payload;
  payloadActivate.effectIndex = effectId;
  payloadActivate.targetChoices = partialChoices;
  return executeActivateRequest(game, payload, player);
}


export function executeDeclareAttackRequest(
  game: Game,
  player: Player,
): void {
  game.actions.declareAttack(player);
  game.addToHistory({
    type: "DeclareAttack",
    issuer: player.id,
  });
}

export function executeAttackRollRequest(
  game: Game,
  player: Player,
): void {
  game.actions.attackRoll(player);
  game.addToHistory({
    type: "AttackRoll",
    issuer: player.id,
  });
}

export async function executeResolveRequest(
  game: Game,
  player: Player,
): Promise<void> {
  if(player.user !== game.currentPlayer.user)  {
    throw new GameError("Only the current player can resolve the stack",
      toSerializedTranslation("error.onlyCurrentPlayerCanResolveStack")
    );
  }
  game.addToHistory({ type: "Resolve", issuer: player.id });
  await game.actions.resolveStack();
}

export function executeSubmitSelectionRequest(
  game: Game,
  payload: Requests.SubmitSelection,
  player: Player,
): void {
  game.submitSelection(
    player,
    payload.requestId,
    payload.selections,
  );
  game.addToHistory({
    type: "SubmitSelection",
    payload,
    issuer: player.id,
  });
}
export function executeInsertStackElementBeforeRequest(
  game: Game,
  payload: Requests.InsertStackElementBefore,
  player: Player,
): void {
  game.insertStackElementBefore(
    player,
    payload.elementToMoveStackId,
    payload.targetStackId,
  );
  game.addToHistory({
    type: "InsertStackElementBefore",
    payload,
    issuer: player.id,
  });
}
export function executeDeclarePurchaseRequest(
  game: Game,
  player: Player,
): void {
  game.actions.declarePurchase(player);
  game.addToHistory({
    type: "DeclarePurchase",
    issuer: player.id,
  });
}
export function executeCancelPurchaseRequest(
  game: Game,
  player: Player,
): void {
  game.actions.cancelPurchase(player);
  game.addToHistory({
    type: "CancelPurchase",
    issuer: player.id,
  });
}
export function executePurchaseRequest(
  game: Game,
  payload: Requests.Purchase,
  player: Player,
): void {
  game.actions.purchase(player, payload.index);
  game.addToHistory({
    type: "Purchase",
    payload,
    issuer: player.id,
  });
}
export async function executeEndTurnRequest(
  game: Game,
  player: Player,
): Promise<void> {
  game.actions.canEndTurn(player, true);
  game.addToHistory({ type: "EndTurn", issuer: player.id });
  await game.actions.nextTurn(player);
}
export async function executeGiveCoinsRequest(
  game: Game,
  payload: Requests.GiveCoins,
  player: Player,
): Promise<void> {
  game.assert.noPendingSelection();
  const target = game.entityHandler.getPlayerById(payload.target);
  const amount = payload.coins;
    if (!await game.giveCoins(player, target, amount))
      return;
    game.addToHistory({
    type: "GiveCoins",
    payload,
    issuer: player.id,
  });
}
export function executeDebugLootTopRequest(
  game: Game,
  player: Player,
): void {
  game.addToHistory({
    type: "DebugLootTop",
    issuer: player.id,
  });
  const topCard = game.decks.loot.cards[0]?.jsonAPI;
  if (!topCard) {
    throw new GameError("Loot deck is empty",
      toSerializedTranslation("error.lootDeckIsEmpty")
    );
  }
  game.actions.debugLoot(player, [topCard], false);
}

export function executeDebugGainTreasureTopRequest(
  game: Game,
  player: Player,
): void {
  game.addToHistory({
    type: "DebugGainTreasureTop",
    issuer: player.id,
  });
  const topCard = game.decks.treasure.cards[0]?.jsonAPI;
  if (!topCard) {
    throw new GameError("Treasure deck is empty",
      toSerializedTranslation("error.treasureDeckIsEmpty")
    );
  }
  game.actions.debugGainTreasures(player, [topCard], true);
}
export function executeDebugLootRequest(
  game: Game,
  payload: Requests.DebugLoot,
  player: Player,
): void {
  game.addToHistory({
    type: "DebugLoot",
    payload,
    issuer: player.id,
  });
  const cards = payload.cards;
  if (cards && cards.length > 0) {
    const lootDeck = game.decks["loot"];
    if (!lootDeck) {
      throw new GameError("Loot deck not available",
        toSerializedTranslation("error.lootDeckNotAvailable")
      );
    }
    game.actions.debugLoot(player, cards);
  }
}

export function executeDebugRemoveCardsRequest(
  game: Game,
  payload: Requests.DebugRemoveCards,
  player: Player,
): void {
game.addToHistory({
  type: "DebugRemoveCards",
  payload,
  issuer: player.id,
});
if (payload.cards !== undefined) {
  const cardsToRemove = game
    .playerCardsAndGameOwnedCards(player)
    .filter((c) =>
      payload.cards
        .map((card) => card.globalId)!
        .includes(c.globalId),
    );
  game.actions.debugRemoveCards(player, cardsToRemove);
}
}
export function executeDebugGainTreasureRequest(
  game: Game,
  payload: Requests.DebugGainTreasure,
  player: Player,
): void {
  game.addToHistory({
    type: "DebugGainTreasure",
    payload,
    issuer: player.id,
  });
  const cards = payload.cards;
  if (cards && cards.length > 0) {
    const treasureDeck = game.decks["treasure"];
    if (!treasureDeck) {
      throw new GameError("Treasure deck not available",
        toSerializedTranslation("error.treasureDeckNotAvailable")
      );
    }
    game.actions.debugGainTreasures(player, cards, false);
  }
}
export function executeDebugGainCoinsRequest(
  game: Game,
  payload: Requests.DebugGainCoins,
  player: Player,
): void {
  game.addToHistory({
    type: "DebugGainCoins",
    payload,
    issuer: player.id,
  });
  game.actions.debugGainCoins(player, payload.coins);
}

export function executeDebugPutMonsterCardInSlotRequest(
  game: Game,
  payload: Requests.DebugPutMonsterCardInSlot,
  player: Player,
): void {
  game.addToHistory({
    type: "DebugPutMonsterCardInSlot",
    payload,
    issuer: player.id,
  });
  const card = game.obtainCard(
    payload.card.slug,
    payload.card.globalId,
  ) as MonsterCard;
  if (!card) {
    throw new GameError(
      "Card not found in the game.",
      toSerializedTranslation("error.cardNotFoundInCardSet")
    );
  }
  const index = 
  payload.toCover === "top" 
  ? "top" 
  : game.encounters._slots
    .map((slot) => slot[slot.length - 1]?.globalId)
    .indexOf(payload.toCover.globalId);
  game.actions.debugPutMonsterCardInSlot(player, card, index);
}

export function executeDebugChangeDiceResultRequest(
  game: Game,
  payload: Requests.DebugChangeDiceResult,
  player: Player,
): void {
  const dice = game.stack.elements.find(e => e.stackId === payload.dice.id);
  if( dice === undefined || dice instanceof DiceRoll === false)
    return;
  game.addToHistory({
    type: "DebugChangeDiceResult",
    payload,
    issuer: player.id,
  });
  game.actions.debugChangeDiceResult(player, dice, payload.value);

}

export function executeDebugPutRoomRequest(
  game: Game,
  payload: Requests.DebugPutRoom,
  player: Player,
): void {
  if(game.rooms === undefined)
    return;
  const room = game.obtainCard(payload.card.slug, payload.card.globalId);
  if(room === undefined || room instanceof RoomCard === false)
    return;
  const idx =  game.rooms.activeRooms
    .map((slot) => slot.globalId)
    .indexOf(payload.toCover.globalId);
  if(idx < 0 || idx >= game.rooms.activeRooms.length)
    throw new GameError("", toSerializedTranslation("error.invalidCardPosition"));

  game.addToHistory({
    type: "DebugPutRoom",
    payload,
    issuer: player.id,
  });
  game.rooms?.forceRoomAtSlot(0, room);
  game.dispatch();
}