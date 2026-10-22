import { Game } from "@/models/game";
import { GameParameters } from "@/models/gameParameters";
import { Team } from "@/shared/api";

export function createNativeBotGame(seed: string, playerCount = 2): Game {
  const params = new GameParameters(() => {});
  params.useFSP2Cards.value = false;
  params.useG2Cards.value = false;
  params.useRCards.value = false;
  params.playWithBonusSouls.value = false;
  params.playWithRooms.value = false;
  const game = new Game(seed, params);
  const characters = ["b2-isaac", "b2-maggy", "b2-cain", "b2-judas"];
  const teams = [Team.Team1, Team.Team2, Team.Team3, Team.Team4];
  const players = characters.slice(0, playerCount).map((character, index) => ({
    issuer: `Bot ${index + 1}`, character, user: `bot:test-${index}`, team: teams[index]!,
  }));
  game.startOfGameSetup(players, false);
  game.addToHistory({ type: "Start", players, params: game.gameParameters.toJson() });
  return game;
}
