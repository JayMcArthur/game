        import { TargetBuilder } from "@/models/targetBuilder";
import { beforeEach, describe, it, expect } from "bun:test";
import { ActionType, Bot, DeclareAttackOnEntityAction, PlayLootAction, PurchaseAction, UseItemAction } from "../../models/bots";
import { Player } from "../../models/entities/player";
import { Game } from "../../models/game";
import { randomSelect, randomSelectMultiple, setupTestGame } from "../testHelpers";
import { LootCard } from "@/models/cards";
import { loadGameFromLogs } from "@/utils/loadGameFromLogs";
const TEST_SAVE = false;
const TEST_STRINGIFY_LOG = false;
const NB_REPEATS = 10000;


let fixedSeed: string = "";
// fixedSeed = "0.7102906181183293";
// fixedSeed = "0.048894188225966424";
let VERBOSE = fixedSeed !== ""; 
// VERBOSE = false; 
let gameId = 0;

describe(   "Random Games", () => {
    let game: Game;
    let player1: Player;
    let player2: Player;
    let shouldRerun = true;
    let uniqueIdCounter = 0;
    let shouldStop = false; 
    // TODO REMOVE GOLDEN TRINKET FROM FORBIDDEN CARDS
    beforeEach(async () => {
        let seed = fixedSeed === "" ?
         Math.random().toString()
          : fixedSeed
        if(!shouldRerun)return;
        if(fixedSeed !== "") shouldRerun = false;
        const setup = await setupTestGame({
                    playerCount: 2,
                    randomSeed: seed,
                    rooms: "random",
                    bonusSouls: "random",
                    forbiddenCards: ["g2-crooked_penny", "r-gnawed_leaf", "b2-portable_slot_machine", "b2-battery_bum", "r-keepers_sack", "r-car_battery", "b2-shiny_rock", "b2-placebo", "fsp2-cursed_globin", "r-eternal_d6", "fsp2-red_candle"]
                });
        console.log(`${gameId++} Random seed for this test: \"${seed}\"`);
        game = setup.game;
        game.waitForNextTick = async () => {};
        player1 = setup.player1;
        player2 = setup.player2!;
        game.select = randomSelect;
        game.selectMultiple = randomSelectMultiple;
        uniqueIdCounter = 0;
        shouldStop = false; 
    });

    it("100 rounds", async () => {
        // throw new Error("This test is currently disabled as it can be very flaky and doesn't provide consistent value. It can be re-enabled for specific seeds that are known to cause issues, or after improving the bot's decision making to reduce the chances of it getting stuck in loops or bad states.");
        Math.random = game.random; // Override Math.random to make the test deterministic and reproducible
        const bot1 = new Bot(game, player1);
        const bot2 = new Bot(game, player2);
        let currentRound = 0;
        let seen = false;
        // console.log(game.getCardByGlobalId(282)!.name);
        while(game.turnHandler.round < 50 && game.turnHandler.numberOfRoundSinceBeginning < 500 && !shouldStop && !game.isGameOver) {
            uniqueIdCounter++;
            // printVerbose(uniqueIdCounter);
            if(uniqueIdCounter > Math.min(100000, 100000))
                throw new Error("Unique ID counter exceeded 100000, there is likely an infinite loop in the test.");
            // if(game.stack.isEmpty() && game.hasCallbacks())
            //     throw new Error("Stack is not empty and there are pending callbacks, which should not happen. This may indicate a bug in stack resolution or callback handling.");
            // await game.resolveCallbacks();
            // const bot = game.currentPlayer === player1 ? bot1 : bot2;
            
            const bot = Math.random() < 0.98 ? 
                game.currentPlayer === player1 
                    ? bot1 
                    : bot2
                : game.currentPlayer === player1 
                    ? bot2
                    : bot1;
            if(game.players[1]!.coins > 10000)
                throw new Error("Player has more than 10000 coins, which should not happen. This may indicate a bug in coin gain or state updates between turns.");
            // for(const card of game.decks.loot.cards)
            //     if(game.decks.loot.cards.filter(c=> c === card).length > 1)
            //     {
            //         console.log(card.name)
            //         throw new Error("Card is present more than once in the loot deck, which should not happen. This may indicate a bug in card generation or state updates between turns.");
            //     }
            // const duplicates = game.players.flatMap(p => p.hand.cards).filter(c => game.decks.loot.cards.includes(c));
            // if(duplicates.length > 0)
            // {
            //     console.log("Duplicates found:", duplicates.map(c => c.name));
            //     throw new Error("Card cannot be given to the player in eachOtherPlayerLootsAndYouLootEffect");
            // }
                // console.log(bot1.me.inPlay.map(c => c.name));
                // console.log(`bot1 ${bot1.me.inPlay.length} items in play, bot2 ${bot2.me.inPlay.length} items in play`);
            // if(game.decks.monster.cards.some(m => m && m.slug === "r-the_harbingers"))
            //     throw new Error("The Harbingers is present in the encounter slots, which should not happen as it is not included in the monster pool. This may indicate a bug in monster spawning or state updates between turns.");
                // console.log(game.decks.monster.cards.slice(0,5).map(c => c.name));
                // for(const slot of game.encounters.slots)
                //     for(const card of slot)
                // console.log("Current monsters in slots:", game.monsters.map(m => m ? m.card.name : null));
                // console.log("Current monsters in encounters:", game.encounters.cardsOnTop.map(m => m ? m.name : null));
                // const mobs = game.monsters.map(m => m ? m.card.name : null);
                // const cards = game.encounters.cardsOnTop.map(m => m ? m.name : null)
                // if(!mobs.every(m => m === null || cards.includes(m)))
                //     throw new Error("There are monsters in the encounter slots that are not present in the encounter deck.");


        //     let findDuplicates = (arr: any[]) => arr.filter((item, index) => arr.indexOf(item) !== index)
        //     const dupli = findDuplicates([...game.encounters.visible.map(m => m ? m.slug : "empty"), ...game.decks.monster.cards.map(c => c.slug)])
        //     for(const card of game.decks.treasure.discard)
        //         if((card.type !== "treasure"))
        //         {
        //             throw new Error(`Card in treasure DISCARD is not a TreasureCard: ${card.name}, ${card.globalId}`);
        //         }
        //      for(const card of game.decks.treasure.cards)
        //         if((card.type !== "treasure"))
        //         {
        //             throw new Error(`Card in treasure deck is not a TreasureCard: ${card.name}, ${card.globalId}`);
        //         }
        //     if(dupli.length > 0)
        //         throw new Error(`Duplicate monsters found in encounter slots: ${game.encounters.visible.map(m => m ? m.slug : "empty").join(", ")}, dupliactes: ${dupli.join(", ")}`);
        //     const dupl = findDuplicates(game.decks.loot._discard.concat([...game.players.flatMap(p=>[...p.hand.cards.map(c => c.id), ...p.inPlay.filter(c=> c instanceof LootCard).map(c => c.id)]),...game.decks.loot._order]));   
        //     if(dupl.length > 0)
        //         throw new Error(`Duplicate cards found in the loot deck. ${game.decks.loot._set.cards.find(c => c.id === dupl[0])?.name}, ${game.decks.loot._discard.includes(dupl[0])}, ${game.players.flatMap(p=>[...p.hand.cards.map(c => c.id), ...p.inPlay.filter(c=> c instanceof LootCard).map(c => c.id)]).includes(dupl[0])}, ${game.decks.loot._order.includes(dupl[0])}`);
        //    if(bot1.me.inPlay.some(c => c.owner !== bot1.me) || bot2.me.inPlay.some(c => c.owner !== bot2.me))
        //         throw new Error(`Player ${bot1.me.id} or ${bot2.me.id} has an item (${bot1.me.inPlay.find(c => c.owner !== bot1.me)?.name || bot2.me.inPlay.find(c => c.owner !== bot2.me)?.name}) in play that is not owned by them. This should not happen and may indicate a bug in state updates between turns.`);
        //     if(game.shop.itemsInShop.some(i => i === undefined))
        //         throw new Error("Shop deck is empty, which should not happen. Check for potential bugs in card obtaining or shop refill." + game.shop._deck.length + ", discard: " + game.shop._deck.discard.length);
            //     console.log("Current monsters in slots:", game.monsters.map(m => m ? m.card.name : null));
            //     game.encounters.slots.forEach((slot, index) => {
            //         console.log(`Slot ${index}: ${slot.map(m => m ? m.name : "empty").join(", ")}`);
            //     });
            // if(game.encounters.cardsOnTop.some(m => !m?.isEvent && ! m?.isCurse && game.monsters.map(monster => monster.card).includes(m!) === false))
            // {
            //     console.log("Current monsters in slots:", game.monsters.map(m => m ? m.card.name : null));
            //     console.log("Current monsters in slots:", game.encounters.cardsOnTop.map(m => m ? m.name : null));
            //     throw new Error("A monster is in the encounter monsters list but not present in the encounter slots, which should not happen. This may indicate a bug in monster spawning or state updates between turns.");
            // }
            // if(game.decks.monster.cards.some(m => m.name === "The Harbingers"))
            //     throw new Error("The Harbingers is present in the encounter slots, which should not happen as it is not included in the monster pool. This may indicate a bug in monster spawning or state updates between turns.");
            // printVerbose(game.monsters.filter(m => m.isEngagedInCombat).length, " monsters engaged in combat.");
            // printVerbose(bot.me.isEngagedInCombat, " engaged in combat: ");
            // const actions = bot.playableActions;
            // let action = actions[Math.floor(Math.random() * actions.length)]!;
            let action;
            try{
                action = bot.randomFeasibleAction;
            } catch(err){
                if((err as Error).message.includes("Game is over."))
                {
                    shouldStop = true;
                    continue;
                }
                throw err;
            }

            // printVerbose("Done.", actions.map(a => a.type + (a instanceof UseItemAction ? ` (${a.item.name})` : "")).join(", "));
            // if(bot.me.inPlay.length < 2)
            //     throw new Error(`Player ${bot.me.id} has less than 2 items in play, which should not happen as the starting item is eternal. This may indicate a bug in item removal or state updates between turns.`);
            // if(game.entityHandler.getAttack(game.currentPlayer)=== 0)
            //     throw new Error("Player has 0 attack, but it's still their turn. This should not happen.");
            // printVerbose("Monsters: ", game.monsters.map(m => `${m.card.name}(${m.currentHealthPoints}HP)${m.isEngagedInCombat ? " engaged" : ""}${m.isDead ? " dead" : ""}`));
            // printVerbose("slots: ", game.encounters.slots.map(slot => slot[slot.length - 1]?.slug).join(", "));
            // if(game.currentPlayer.diceModifier + game.currentPlayer.attackDiceModifier >= 2)
            //     throw new Error("Player has 5 or more dice modifier, which should not be possible. Check for potential bugs in stat modification or stacking.");
            if(action === null && bot.me !== game.currentPlayer)
                continue;
            if(action === null) {
                displayPlentyOfInfo(bot);
                // const logs = game.getRollbackLog(game.currentPlayer);
                // const filename = `./${game.seed}klalalala.json`;
                // await Bun.write(filename, JSON.stringify(logs, null, 2));

                throw new Error(`Seed: ${game.seed}, Player ${bot.me.id} has no playable actions at round ${game.turnHandler.round}. This should not happen.`);
            }
            // if(!seen && game.monsters.some(m => m.card.slug === "b2-cod_worm"))
            //     seen = true;
            // if((seen && !game.monsters.some(m => m.card.slug === "b2-cod_worm")))
            //     throw new Error("Nerve Ending was seen but is no longer present, it may have been killed or removed from combat. This should be possible but is worth investigating if it happens consistently with the same seed.");
            // if(game.entitiesInCombat.some(e => e.card.slug === "b2-cod_worm"))
            // console.log("Both have donation machines ?, ", player1.inPlay.map(i => i.slug).includes("b2-donation_machine"), player2.inPlay.map(i => i.slug).includes("b2-donation_machine"));
            //                     throw new Error("Nerve Ending was seen but is no longer present, it may have been killed or removed from combat. This should be possible but is worth investigating if it happens consistently with the same seed.");
            // printVerbose(`${uniqueIdCounter} Round ${game.turnHandler.round}:${game.turnHandler.current.id},  Player ${bot.me.id} try execute action: ${action.type}`);
            // printVerbose("attack requirement: ", bot.me.hasAttackRequirement, " free attacks remaining: ", bot.me.hasFreeAttackRemaining, " attacks remaining: ", bot.me.attackThisTurn);
            // printVerbose("engaged in combat: ", game.entitiesInCombat.map(e => e.id).join(", "));
            switch(action.type) {
                case ActionType.PURCHASE:
                    if(action instanceof PurchaseAction === false)
                        throw new Error("Expected PurchaseAction");
                    const index = Math.floor(Math.random() * (game.shop._slots.length + 1));
                    printVerbose(`    Try ${bot.me.id} executed action: ${action.type}, ${index === game.shop._slots.length ? "top of the treasure deck" : `slot ${index} (${game.shop._slots[index] && game.shop._slots[index]![0] ? game.shop._slots[index]![0].name : "empty"})`}`);
                    if(index === game.shop._slots.length)
                    {
                        if(game.actions.canPurchase(bot.me, "top", false) !== true)
                            action.index = Math.floor(Math.random() * (game.shop._slots.length));
                        else
                            action.index = "top";
                    }
                    else
                        action.index = index;
                    break;
                case ActionType.USE_ITEM:
                    if(action instanceof UseItemAction === false)
                        throw new Error("Expected UseItemAction");
                    // printVerbose(` inPlay: ${player2.inPlay.map(i => i.name).join(", ")}`);
                    // printVerbose(` coins: ${player2.coins}`);
                    printVerbose(`    Try ${bot.me.id} executed action: use_item, ${`item: ${action.item.name}`} (owner: ${action.item.owner.id}, ${game.getOwner(action.item)!.id}, global id: ${action.item.globalId}, stack size: ${game.stack.elements.length} targets: ${action.targets === undefined ? [] : TargetBuilder.convertToSelectionItems(action.targets)}`);
                        // with in play items: ${bot.me.inPlay.map(i => i.name).join(", ")},
                    if(!bot.me.inPlay.includes(action.item))
                        throw new Error(`Bot tried to use item ${action.item.name} which is not in their in-play area. This should not happen and may indicate a bug in action feasibility checking or state updates between action selection and execution.`);
                    try {
                        if(bot.game.actions.canActivate(action.item, bot.me) !== true)
                            throw new Error(`Item ${action.item.name} cannot be activated by player ${bot.me.id}`);
                        const result = TargetBuilder.buildRandomValidTargets(game, bot.me, action.item, "inPlay");
                        if(typeof result === "string")                         
                            throw new Error(`Failed to build targets for item ${action.item.name}: ${result} ${game.players.map(p => p.inPlay.length)}`);
                        action.targets = result.targets;
                        action.index = result.index;
                    } catch (targetErr) {
                        console.error(`      ✗ Error building targets for ${action.item.name}:`, targetErr && (targetErr as Error).message);
                        throw targetErr;
                    }
                    break;
                case ActionType.PLAY_LOOT:
                    if(action instanceof PlayLootAction === false)
                        throw new Error("Expected PlayLootAction");
                    const playAction = action as PlayLootAction;
                    const card = bot.me.hand.cards[playAction.index]!;
                    
                    const res = TargetBuilder.buildRandomValidTargets(game, bot.me, card, "hand");
                    // if(game.currentPlayer.hand.cards[action.index]!.slug.includes("fsp2-questionmark_card"))
                    printVerbose(`    Try ${bot.me.id} executed action: ${action.type}, ${`loot: ${bot.me.hand.cards[action.index]!.slug}`}`);
                    if(typeof res === "string")
                        throw new Error(`Failed to build targets for loot card ${card.name}: ${res}`);
                    if (typeof res !== "string") {
                        // printVerbose("targets:", TargetBuilder.convertToSelectionItems(res.targets));
                        action.targets = res.targets;
                    }
                    break;
                case ActionType.END_TURN:
                    printVerbose(`${bot.me.id} send end turn \n`);
                    break;
                case ActionType.ATTACK:
                    if(action instanceof DeclareAttackOnEntityAction === false)
                        throw new Error("Expected DeclareAttackOnEntityAction");
                    printVerbose(`    declare attack on: ${action.target === "topDeck" ? "top of the monster deck" : action.target.card.name}`);
                    // printVerbose("Monsters: ", game.monsters.map(m => `${m.card.name}(${m.currentHealthPoints}HP)${m.isEngagedInCombat ? " engaged" : ""}${m.isDead ? " dead" : ""}`).join(", "));

                    break;
                case ActionType.RESOLVE_STACK:
                    // await Promise.resolve(); // Ensure any synchronous effects are processed before potentially awaiting resolution
                    // await Promise.resolve(); // Ensure any synchronous effects are processed before potentially awaiting resolution
                    // await Promise.resolve(); // Ensure any synchronous effects are processed before potentially awaiting resolution
                    // await Promise.resolve(); // Ensure any synchronous effects are processed before potentially awaiting resolution
                    // await Promise.resolve(); // Ensure any synchronous effects are processed before potentially awaiting resolution
                    // printVerbose(`in Play: ${bot.me.inPlay.map(i => i.name).join(", ")}`);
                    // if(game.stack.peek()?.json.type === "LootCardEffect")
                        printVerbose(`    Try ${bot.me.id} executed action: resolve_stack to resolve ${game.stack.peek()?.debugLogs}, coins :${bot.me.coins},stack size: ${game.stack.elements.length}`);
                        // printVerbose(bot.me.inPlay.map(c=>c!.name))
                    // if(game.stack.peek()?.json.card?.slug === "b2-steamy_sale" && game.stack.peek()?.json.effect === "Steal 1¢ from another player when they gain coins.")
                    //     throw new Error("Stack contains Tech X steal effect, which can cause infinite loops if the bot keeps trying to resolve it while there are no coins to steal. This should be investigated if it happens consistently with the same seed.");
                    if(game.stack.size > 10000) {
                            game.stack.elements.forEach(e => {
                                console.log(`  Stack element ${e.debugLogs}`);
                            });
                        throw new Error(`Stack size exceeded 1000 "${game.seed}"`);
                    }
                    break;
                case ActionType.DECLARE_ATTACK:
                case ActionType.DECLARE_PURCHASE:
                case ActionType.CANCEL_PURCHASE:
                case ActionType.ROLL:
                    printVerbose(`    Try ${bot.me.id} executed action: ${action.type}`);
                    break;
                default:
                    throw new Error(`Unhandled action type: ${action.type}`);
            }
            try {
                await action.execute(game);
                // printVerbose(`  ✓ ${action.type} executed successfully`);
                // printVerbose(`  Resolving stack...${game.stack.elements.map(e => JSON.stringify(e.json)).join(", ")}`);
                // let maxIterations = 5; // Prevent infinite loops in case of bugs
                // while(!game.stack.isEmpty() && maxIterations > 0) {
                //     await game.resolveEntireStack();
                //     maxIterations--;
                // }
                // expect(game.stack.isEmpty()).toBe(true);
            } catch (execErr) {
                // deck is so empty that even after resetting the discard pile there's not enough cards to draw, skip this action and continue the test, as this is a valid game state (can happen if the bot tries to buy from an empty treasure deck for example)
                if(execErr && 
                    ["Cannot purchase from shop slot 1, it is empty. The deck has 0 cards left.",
                    "Cannot purchase from shop slot 0, it is empty. The deck has 0 cards left.",
                    "Cannot purchase from shop slot 2, it is empty. The deck has 0 cards left.",
                    "Cannot draw card at position 0 from top even after resetting discard, deck of type treasure has only 0 cards.",
                    "Cannot draw card at position 0 from top even after resetting discard, deck of type loot has only 0 cards.",
                    "Game is over. You must leave.",
                    ].includes((execErr as Error).message) || (execErr as Error).message.includes("The deck has 0 cards left.") || (execErr as Error).message.includes("has only 0 cards."))
                    {
                        console.log(`  ✗ ${action.type} failed due to ${(execErr as Error).message}`);
                            // , skipping action. This can happen if the bot tries to purchase from an empty shop slot or draw from an empty deck. Error message: ${(execErr as Error).message}`);
                        shouldStop = true;
                    }
                    else
                    {
                        console.error(`  ✗ Error round ${game.turnHandler.round} executing ${action.type}:`, execErr && (execErr as Error).message);
                        throw execErr;
                    }
            }
            if(shouldStop)
            {
                console.log(`Stopping test after ${uniqueIdCounter} actions due to empty deck.`);
                break;
            }
            // printVerbose(`  ✓ Stack resolved`);
        } 
        if(!shouldStop)
        {
            if(TEST_SAVE)
            {
                const logs = game.getRollbackLog(game.currentPlayer);
                const filename = `./src/tests/mechanics/logs/${game.seed}.json`;
                console.log(`Saving game logs to ${filename}`);
                await Bun.write(filename, JSON.stringify(logs, null, 2));
                expect(async () => await loadGameFromLogs(logs)).not.toThrow();
            }
            if(TEST_STRINGIFY_LOG)
            {
                
                expect(() => JSON.stringify(game.log)).not.toThrow();
            }
        }
        // printVerbose(JSON.stringify(game.detailedStateJSON(game.players[0]!)));
    }, {repeats: NB_REPEATS, timeout: 10000});


































    function printVerbose(...args: any[]) {
            if(VERBOSE)
                console.log(...args);
        }

    function displayPlentyOfInfo(bot: Bot) {
        printVerbose(bot.me.attackThisTurn <= 0, !bot.me.hasAttackRequirement, !bot.me.hasFreeAttackRemaining);
        printVerbose(`${bot.me.isEngagedInCombat ? "Engaged" : "Not engaged"}`);
        printVerbose(game.hasPendingSelections ? " There are pending selections." : "No pending selections.");
        printVerbose("can end turn:", game.actions.canEndTurn(bot.me, false));
        printVerbose("Can declare attack: ", game.actions.canDeclareAttack(bot.me, false));
        printVerbose(bot.me.attackThisTurn, " attacks remaining.");
        printVerbose(bot.me.isDead ? "Player is dead." : "Player is alive.");
        for(const monster of game.monsters) {
            printVerbose(monster.id, game.actions.canDeclareAttackOnEntity(bot.me, monster) === true ? "Can declare attack on monster." : game.actions.canDeclareAttackOnEntity(bot.me, monster));
        }
        printVerbose(game.actions.canDeclareAttackOnEntity(bot.me, "topDeck") === true ? "Can declare attack on monster." : game.actions.canDeclareAttackOnEntity(bot.me, "topDeck"));
        printVerbose(bot.me.hasAttackRequirement ? "Player has attack requirement." : "Player has no attack requirement.");
        printVerbose(game.actions.canEndTurn(bot.me, false) === true ? "Player can end turn." : game.actions.canEndTurn(bot.me, false));
        printVerbose(game.stack.isEmpty() ? "Stack is empty." : "Stack is not empty.");
        printVerbose(game.monsters.filter(m => m.isEngagedInCombat).length, " monsters engaged in combat.");
        // printVerbose("Requirement list; ", JSON.stringify(bot.me.requirementListJSON(game), null, 2));
        // bot.me.requirementListPRINT();

    }
});