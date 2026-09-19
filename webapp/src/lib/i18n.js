import { useSyncExternalStore } from 'react';

/**
 * Amharic + English for the Mini App. Amharic is the default; the bot may pass `?lang=am|en`
 * and the player can switch in the lobby or on the profile screen (remembered per device).
 *
 * Both languages carry exactly the same keys (scripts/check-i18n.mjs enforces it). Not translated
 * on purpose: the brand "USA Bingo", the letters B I N G O, numbers, reference ids, player names.
 */
export const LANGS = [
  { id: 'am', label: 'አማርኛ', short: 'አማ' },
  { id: 'en', label: 'English', short: 'EN' },
];
const DEFAULT_LANG = 'am';
const STORAGE_KEY = 'tgb-lang';

export const STRINGS = {
  en: {
    // ----- shared -----
    'common.etb': 'ETB',
    'common.back': 'Back',
    'common.loading': 'Loading…',
    'common.player': 'Player',
    'common.max': 'MAX',
    'common.sending': 'Sending…',
    'common.connected': 'Connected',
    'common.disconnected': 'Disconnected',
    'common.optional': '(optional)',
    'common.phonePlaceholder': '09… or +2519…',
    'common.network': 'Network problem. Check your connection.',
    'time.hm': '{h}h {m}m',
    'time.m': '{m}m',

    // ----- bottom bar -----
    'nav.play': 'Lobby',
    'nav.missions': 'Missions',
    'nav.wallet': 'Wallet',
    'nav.transfer': 'Send',
    'nav.profile': 'Profile',
    'nav.new': 'NEW',

    // ----- suspended screen -----
    'app.suspendedHelp': 'Your wallet balance is kept. Contact support through the bot if you think this is a mistake.',

    // ----- lobby -----
    'lobby.shopAria': 'Coins and shop',
    'lobby.shop': 'SHOP ›',
    'lobby.langAria': 'Switch language',
    'lobby.finishSignup': 'Finish your sign-up',
    'lobby.finishSignupHelp': 'Add your display name and phone number to your profile.',
    'lobby.freeBingo': 'Free Bingo',
    'lobby.stakeBingo': '{amount} Bingo',
    'lobby.freeEntry': 'Free entry',
    'lobby.entry': '{amount} entry',
    'lobby.prizeCoins': 'Prize: 🪙 {coins} coins',
    'lobby.prizeUpTo': 'Prize up to {amount}',
    'lobby.player': '{n} player',
    'lobby.players': '{n} players',
    'lobby.picked': '{n} picked',
    'lobby.status.open': 'Open · be the first',
    'lobby.status.startsIn': 'starts in {s} s',
    'lobby.status.playing': 'in progress · call {n}',
    'lobby.status.reopening': 're-opening…',
    'lobby.status.registering': 'registering',
    'lobby.join': 'JOIN',
    'lobby.joining': 'JOINING…',
    'lobby.deposit': 'DEPOSIT',
    'lobby.leaderboard': 'Leaderboard',
    'lobby.noRounds': 'No rounds played yet. Be the first!',
    'lobby.win': '{n} win',
    'lobby.wins': '{n} wins',

    // ----- pick screen -----
    'pick.registering': 'Registering · {ready}/{min} picked',
    'pick.perCartela': '{amount} per cartela · {n} cartelas in play · prize {prize}',
    'pick.inRoom': '{n} in room',
    'pick.count': '{n}/{max} cartelas picked',
    'pick.staked': '{amount} staked',
    'pick.giveBackHint': 'tap one of yours to give it back',
    'pick.empty': 'Tap numbers above to get up to {max} cartelas',
    'pick.pickedList': 'Picked ({n})',
    'pick.you': '(you)',
    'pick.takenBy': 'Taken by {name}',
    'pick.giveBack': 'Give back cartela {n}',
    'pick.start': 'Start Game',

    // ----- table -----
    'game.leave': 'Leave',
    'game.leaveCaps': 'LEAVE',
    'game.refresh': 'Refresh',
    'game.refreshCaps': 'REFRESH',
    'game.bingo': 'BINGO!',
    'game.stat.prize': 'Prize',
    'game.stat.call': 'Call',
    'game.stat.players': 'Players',
    'game.stat.playersCartelas': 'Players · Cartelas',
    'game.nCartelas': '{n} cartelas',
    'game.free': 'Free',
    'game.callLabel': 'CALL',
    'game.previousCalls': 'Previous calls',
    'game.cartela': 'Cartela {n}',
    'game.youHaveBingo': 'You have BINGO · press the button!',
    'game.roundInProgress': 'Round in progress. Pick a cartela when registration re-opens.',
    'game.notCalledYet': '{call} has not been called yet',
    'game.sound.offAria': 'Sound off. Tap for Amharic call-outs',
    'game.sound.amAria': 'Amharic call-outs. Tap for English',
    'game.sound.enAria': 'English call-outs. Tap to mute',
    'game.autoTitle': 'Mark called numbers on your cartelas automatically',
    'game.aboutToStart': 'Game is about to start!',
    'game.waitingPlayers': 'Waiting for more players…',
    'game.prizePool': 'Prize · {amount}',
    'game.freeTable': 'Free table',
    'game.nPlaying': '{n} playing',
    'game.changeCartela': 'Change cartela',
    'game.leaveGame': 'Leave game',
    'game.dismiss': 'Dismiss',

    // ----- win modal -----
    'win.won': '{name} won!! 🎉',
    'win.none': 'No winner this round 😶',
    'win.cartela': 'Cartela ~ {n}',
    'win.full': 'Full card',
    'win.corners': 'Four corners',
    'win.line': 'Line',
    'win.prize': '{amount} won',
    'win.you': 'That is you! 🏆',
    'win.numbers': '{numbers} · on call {call}',
    'win.refunded': '{n} numbers were called. Stakes were refunded.',
    'win.again': 'Play Again',
    'win.leaveRoom': 'Leave room',

    // ----- wallet -----
    'wallet.title': 'Wallet',
    'wallet.available': 'Available balance',
    'wallet.held': '{amount} held for pending cash-outs',
    'wallet.waitingPayment': 'Waiting for payment confirmation…',
    'wallet.sendToPlayer': 'Send to another player by phone number',
    'wallet.short': 'Deposit at least {amount} to join the {table} table.',
    'wallet.tab.deposit': 'Deposit',
    'wallet.tab.cashout': 'Cash out',
    'wallet.mode.transfer': 'Transfer + receipt',
    'wallet.mode.online': 'Pay online',
    'wallet.soonTitle': 'Deposits open soon',
    'wallet.soonBody': 'Our Telebirr accounts are being set up. Check back shortly.',
    'wallet.bankAccounts': 'Bank accounts',
    'wallet.accountName': 'Name:',
    'wallet.copy': 'COPY',
    'wallet.copied': 'DONE ✓',
    'wallet.copyFailed': 'Could not copy. Long-press the number to copy it.',
    'wallet.sendInstruction': 'Send the amount to the account you copied{account}, then paste the receipt id below.',
    'wallet.amountSent': 'Amount you sent',
    'wallet.amountSentAria': 'Transferred amount',
    'wallet.receiptId': 'Receipt / transaction id',
    'wallet.receiptIdAria': 'Transaction id',
    'wallet.paste': 'PASTE',
    'wallet.pasteFailed': 'Paste the id into the field (clipboard access was refused).',
    'wallet.payerPhone': 'Phone you sent from',
    'wallet.payerName': 'Name on the receipt',
    'wallet.senderName': 'Sender name',
    'wallet.limits': 'Min {min} · Max {max} {currency}',
    'wallet.transferHelp': '{limits}. Telebirr receipts are checked automatically; others are confirmed by our team. The phone and name help us find your transfer if the id is mistyped.',
    'wallet.fee': '{percent}% fee',
    'wallet.youReceive': 'you receive',
    'wallet.submitting': 'Submitting…',
    'wallet.confirmTransfer': 'Confirm my transfer',
    'wallet.amountAria': 'Amount',
    'wallet.startingPayment': 'Starting payment…',
    'wallet.pay': 'Pay {amount}',
    'wallet.cashout.title': 'Cash out',
    'wallet.cashout.help': 'The amount is held from your balance right away and paid out once approved, usually within a day.',
    'wallet.cashout.from': 'Payouts come from {account}.',
    'wallet.cashout.which': 'Which {method} number should receive the money?',
    'wallet.cashout.accountAria': '{method} number to pay out to',
    'wallet.cashout.useMine': 'Use my number {phone}',
    'wallet.cashout.willSend': '{amount} will be sent to {method} {account} after approval.',
    'wallet.cashout.amountAria': 'Cash-out amount',
    'wallet.cashout.request': 'Request {amount}',
    'wallet.cashout.pending': 'Pending approval',
    'wallet.cashout.cancel': 'Cancel',
    'wallet.notice.depositVerified': 'Receipt {ref} confirmed. {amount} added to your wallet.',
    'wallet.notice.depositSubmitted': 'Receipt {ref} submitted. Your wallet is credited once the transfer is confirmed, usually within minutes.',
    'wallet.notice.cashoutRequested': 'Cash-out of {amount} requested. You receive {payout} once approved.',
    'wallet.notice.cashoutCancelled': 'Cash-out cancelled and refunded to your wallet.',
    'wallet.activity': 'Recent activity',
    'wallet.noActivity': 'No activity yet.',
    'wallet.ledgerFee': '{amount} − {fee} fee',
    'status.paid': 'paid',
    'status.pending': 'pending',
    'status.failed': 'failed',
    'status.cancelled': 'cancelled',
    'status.rejected': 'rejected',
    'method.telebirr.label': 'Telebirr',
    'method.telebirr.desc': 'Ethio Telecom mobile money',
    'method.cbebirr.label': 'CBE Birr',
    'method.cbebirr.desc': 'Commercial Bank of Ethiopia',
    'method.boa.label': 'Bank of Abyssinia',
    'method.boa.desc': 'BoA account / card',

    // ----- send money -----
    'transfer.title': 'Send money',
    'transfer.available': 'Available to send',
    'transfer.heading': 'Transfer to another player',
    'transfer.help': 'Enter the phone number the player signed up with. The money moves instantly between wallets, with no fee.',
    'transfer.phoneLabel': 'Recipient phone number',
    'transfer.phoneAria': 'Recipient phone',
    'transfer.minPlaceholder': 'Min {n}',
    'transfer.amountAria': 'Amount to send',
    'transfer.sent': 'Sent {amount} to {name} ({phone}).',
    'transfer.send': 'Send {amount}',
    'transfer.sendTo': 'Send {amount} to {name}',
    'transfer.recent': 'Recent transfers',
    'transfer.none': 'No transfers yet.',

    // ----- profile -----
    'profile.title': 'Profile',
    'profile.signedUp': '✓ Signed up',
    'profile.incomplete': '! Sign-up incomplete',
    'profile.finishLead': 'Finish your sign-up.',
    'profile.finishBody': 'Add your display name and phone number below, or send {command} to the bot.',
    'profile.stat.games': 'Games',
    'profile.stat.wins': 'Wins',
    'profile.stat.won': 'Won',
    'profile.fields': 'Profile fields',
    'profile.displayName': 'Display name',
    'profile.displayNameHint': 'How other players see you',
    'profile.phone': 'Phone number',
    'profile.telegram': 'Telegram',
    'profile.signedUpAt': 'Signed up',
    'profile.saved': 'Saved ✓',
    'profile.saving': 'Saving…',
    'profile.save': 'Save profile',
    'profile.logout': 'Log out & close',
    'profile.language': 'Language / ቋንቋ',

    // ----- missions -----
    'missions.title': 'Missions',
    'missions.resetIn': 'Daily missions reset in {time}.',
    'missions.ready': '{n} reward ready to claim!',
    'missions.readyMany': '{n} rewards ready to claim!',
    'missions.reward': 'reward',
    'missions.done': 'Done ✓',
    'missions.claim': 'Claim',
    'mission.play3.title': 'Play 3 rounds',
    'mission.win1.title': 'Win a round',
    'mission.mark50.title': 'Mark 50 numbers',
    'mission.paid1.title': 'Play a paid table',

    // ----- shop -----
    'shop.title': 'Shop',
    'shop.earn': 'Earn coins from {missions}. Coins never convert to ETB.',
    'shop.earnLink': 'missions',
    'shop.skins': 'Cartela skins',
    'shop.classic': 'Classic cartela',
    'shop.inUse': 'In use ✓',
    'shop.use': 'Use',
    'shop.boosters': 'Boosters',
    'shop.history': 'Coin history',
    'shop.theme_emerald.title': 'Emerald cartela',
    'shop.theme_emerald.desc': 'Green & gold card skin',
    'shop.theme_sunset.title': 'Sunset cartela',
    'shop.theme_sunset.desc': 'Orange & pink card skin',
    'shop.theme_neon.title': 'Neon cartela',
    'shop.theme_neon.desc': 'Cyan & magenta card skin',
    'shop.theme_gold.title': 'Gold cartela',
    'shop.theme_gold.desc': 'The VIP look',

    // ----- server errors (see ERROR_RULES; the English side documents the server text) -----
    'err.insufficientRoom': 'Insufficient balance: this room costs {stake} per cartela',
    'err.insufficientHave': 'Insufficient balance: you have {amount}',
    'err.insufficient': 'Insufficient balance',
    'err.gameRunning': 'Game already in progress',
    'err.roomFull': 'Room is full',
    'err.waitToPick': 'Wait for the next round to pick a cartela',
    'err.waitToChange': 'Wait for the next round to change cartelas',
    'err.notInRoom': 'You are not in a room',
    'err.notInRound': 'You are not in this round',
    'err.pickBetween': 'Pick a cartela between 1 and {max}',
    'err.cartelaTaken': 'Cartela {n} is already taken by {name}',
    'err.maxCartelas': 'You can hold up to {max} cartelas',
    'err.notYourCartela': 'You do not hold cartela {n}',
    'err.needPlayers': 'Need at least {n} players with a cartela',
    'err.noGame': 'No game running',
    'err.notCalled': 'That number has not been called',
    'err.notOnCards': 'That number is not on your cards',
    'err.notOnCartela': 'That number is not on cartela {n}',
    'err.notYetFull': 'Not yet: {marked}/{total} marked',
    'err.notYetLine': 'Not yet: complete a row, column, diagonal or all four corners ({marked}/{total} marked)',
    'err.roomNotFound': 'Room not found',
    'err.unknownStake': 'Unknown stake',
    'err.tableClosed': 'This table was closed by the operator',
    'err.requestFailed': 'Request failed',
    'err.requestFailedCode': 'Request failed ({code})',
    'err.openFromTelegram': 'Open this game from Telegram to play online.',
    'err.suspendedUntil': 'Account suspended until {date}{reason}',
    'err.suspendedForever': 'Account suspended permanently{reason}',
    'err.suspended': 'Account suspended{reason}',
    'err.suspendedByOperator': 'Suspended by operator',
    'err.amountBetween': 'Amount must be between {min} and {max} {currency}',
    'err.amountPositive': 'Amount must be positive',
    'err.minTransfer': 'Minimum transfer is {min} {currency}',
    'err.unknownMethod': 'Unknown payment method',
    'err.paymentStart': 'Could not start payment. Please try again.',
    'err.payerPhone': 'The phone you sent from does not look like a phone number, e.g. 0900000000 (or leave it empty)',
    'err.methodNoTransfer': 'Transfers are not accepted through this method',
    'err.validPhone': 'Enter a valid phone number, e.g. 0900000000',
    'err.noSuchPlayer': 'No player with that phone number has signed up yet',
    'err.ownNumber': 'That is your own number',
    'err.sendToSelf': 'You cannot send money to yourself',
    'err.payoutPhone': 'Enter the {method} phone number to pay out to, e.g. 0900000000',
    'err.payoutOnly': 'Cash-outs are paid by {method} only',
    'err.payoutAccount': 'Enter the phone or account number to pay out to',
    'err.notFound': 'Not found',
    'err.receiptFormat': 'Enter the transaction / receipt id exactly as shown on the receipt (6–32 letters and digits)',
    'err.receiptUsed': 'This transaction id has already been submitted',
    'err.withdrawalAlready': 'Withdrawal already {status}',
    'err.nameLength': 'Name must be {min}–{max} characters',
    'err.phoneDigits': 'Phone must be 7–15 digits, e.g. +251900000000',
    'err.nothingToUpdate': 'Nothing to update',
    'err.notEnoughCoins': 'Not enough coins: you need {need}, you have {have}',
    'err.bonusClaimed': 'Daily bonus already claimed. Come back tomorrow!',
    'err.missionClaimed': 'Mission reward already claimed',
    'err.missionNotDone': 'Not finished yet: {progress}/{goal}',
    'err.skinOwned': 'You already own this skin',
    'err.skinNotOwned': 'You do not own this skin',

    // ----- ledger notes written by the server (see NOTE_RULES) -----
    'note.stake': 'Stake for cartela {n} in room {code}',
    'note.refund': 'Refund for cartela {n} in room {code}',
    'note.prize': 'Prize for room {code}',
    'note.adjustment': 'Adjusted by USA Bingo: {reason}',
    'note.transfer': 'Transfer {detail}',
    'note.deposit': 'Transfer via {method}, receipt {ref}',
    'note.cashout': 'Cash out to {method} {account}',
    'note.cancelledByPlayer': 'Cancelled by player',
    'note.notConfirmed': 'Transfer could not be confirmed',
    'note.dailyBonus': 'Daily bonus · day {day}',
    'note.mission': 'Mission · {title}',
    'note.shop': 'Shop · {title}',
    'note.wonFree': 'Won Free Bingo',
  },

  am: {
    // ----- shared -----
    'common.etb': 'ብር',
    'common.back': 'ተመለስ',
    'common.loading': 'በመጫን ላይ…',
    'common.player': 'ተጫዋች',
    'common.max': 'ሁሉም',
    'common.sending': 'በመላክ ላይ…',
    'common.connected': 'ተገናኝቷል',
    'common.disconnected': 'ግንኙነት ተቋርጧል',
    'common.optional': '(አማራጭ)',
    'common.phonePlaceholder': '09… ወይም +2519…',
    'common.network': 'የኔትወርክ ችግር። ግንኙነትዎን ያረጋግጡ።',
    'time.hm': '{h}ሰ {m}ደ',
    'time.m': '{m}ደ',

    // ----- bottom bar -----
    'nav.play': 'ሎቢ',
    'nav.missions': 'ተልዕኮ',
    'nav.wallet': 'ዋሌት',
    'nav.transfer': 'ላክ',
    'nav.profile': 'ፕሮፋይል',
    'nav.new': 'አዲስ',

    // ----- suspended screen -----
    'app.suspendedHelp': 'በዋሌትዎ ያለው ገንዘብ አይነካም። ስህተት ነው ብለው ካሰቡ በቦቱ በኩል ድጋፍ ሰጪዎችን ያግኙ።',

    // ----- lobby -----
    'lobby.shopAria': 'ኮይኖች እና ሱቅ',
    'lobby.shop': 'ሱቅ ›',
    'lobby.langAria': 'ቋንቋ ይቀይሩ',
    'lobby.finishSignup': 'ምዝገባዎን ያጠናቅቁ',
    'lobby.finishSignupHelp': 'ስምዎን እና ስልክ ቁጥርዎን በፕሮፋይልዎ ላይ ያስገቡ።',
    'lobby.freeBingo': 'ነፃ ቢንጎ',
    'lobby.stakeBingo': '{amount} ቢንጎ',
    'lobby.freeEntry': 'መግቢያ ነፃ',
    'lobby.entry': 'መግቢያ {amount}',
    'lobby.prizeCoins': 'ሽልማት፦ 🪙 {coins} ኮይን',
    'lobby.prizeUpTo': 'ሽልማት እስከ {amount}',
    'lobby.player': '{n} ተጫዋች',
    'lobby.players': '{n} ተጫዋቾች',
    'lobby.picked': '{n} መርጠዋል',
    'lobby.status.open': 'ክፍት · ቀዳሚ ይሁኑ',
    'lobby.status.startsIn': 'በ{s} ሰከንድ ይጀምራል',
    'lobby.status.playing': 'በጨዋታ ላይ · ጥሪ {n}',
    'lobby.status.reopening': 'እንደገና በመከፈት ላይ…',
    'lobby.status.registering': 'ምዝገባ ላይ',
    'lobby.join': 'ይጫወቱ',
    'lobby.joining': 'በመግባት ላይ…',
    'lobby.deposit': 'ያስገቡ',
    'lobby.leaderboard': 'ምርጥ ተጫዋቾች',
    'lobby.noRounds': 'እስካሁን የተጫወተ ዙር የለም። ቀዳሚ ይሁኑ!',
    'lobby.win': '{n} ድል',
    'lobby.wins': '{n} ድል',

    // ----- pick screen -----
    'pick.registering': 'ምዝገባ · {ready}/{min} መርጠዋል',
    'pick.perCartela': 'በካርቴላ {amount} · {n} ካርቴላ በጨዋታ · ሽልማት {prize}',
    'pick.inRoom': '{n} ተጫዋች በክፍሉ',
    'pick.count': '{n}/{max} ካርቴላ ተመርጧል',
    'pick.staked': 'መደብ {amount}',
    'pick.giveBackHint': 'ለመመለስ የእርስዎን ካርቴላ ይጫኑ',
    'pick.empty': 'እስከ {max} ካርቴላ ለመያዝ ከላይ ያሉትን ቁጥሮች ይጫኑ',
    'pick.pickedList': 'የመረጡ ({n})',
    'pick.you': '(እርስዎ)',
    'pick.takenBy': 'በ{name} ተይዟል',
    'pick.giveBack': 'ካርቴላ {n} ይመልሱ',
    'pick.start': 'ይጀምሩ',

    // ----- table -----
    'game.leave': 'ይውጡ',
    'game.leaveCaps': 'ይውጡ',
    'game.refresh': 'አድስ',
    'game.refreshCaps': 'አድስ',
    'game.bingo': 'ቢንጎ!',
    'game.stat.prize': 'ሽልማት',
    'game.stat.call': 'ጥሪ',
    'game.stat.players': 'ተጫዋቾች',
    'game.stat.playersCartelas': 'ተጫዋች · ካርቴላ',
    'game.nCartelas': '{n} ካርቴላ',
    'game.free': 'ነፃ',
    'game.callLabel': 'ጥሪ',
    'game.previousCalls': 'ያለፉ ጥሪዎች',
    'game.cartela': 'ካርቴላ {n}',
    'game.youHaveBingo': 'ቢንጎ አግኝተዋል · ቁልፉን ይጫኑ!',
    'game.roundInProgress': 'ዙሩ በመካሄድ ላይ ነው። ምዝገባ ሲከፈት ካርቴላ ይምረጡ።',
    'game.notCalledYet': '{call} ገና አልተጠራም',
    'game.sound.offAria': 'ድምፅ ጠፍቷል። ለአማርኛ ጥሪ ይጫኑ',
    'game.sound.amAria': 'የአማርኛ ጥሪ። ለእንግሊዝኛ ይጫኑ',
    'game.sound.enAria': 'የእንግሊዝኛ ጥሪ። ድምፅ ለማጥፋት ይጫኑ',
    'game.autoTitle': 'የተጠሩ ቁጥሮች በካርቴላዎ ላይ በራስ-ሰር ምልክት ይደረግባቸዋል',
    'game.aboutToStart': 'ጨዋታው ሊጀመር ነው!',
    'game.waitingPlayers': 'ተጨማሪ ተጫዋቾችን በመጠበቅ ላይ…',
    'game.prizePool': 'ሽልማት · {amount}',
    'game.freeTable': 'ነፃ ጠረጴዛ',
    'game.nPlaying': '{n} እየተጫወቱ ነው',
    'game.changeCartela': 'ካርቴላ ይቀይሩ',
    'game.leaveGame': 'ከጨዋታው ይውጡ',
    'game.dismiss': 'ዝጋ',

    // ----- win modal -----
    'win.won': '{name} አሸንፏል!! 🎉',
    'win.none': 'በዚህ ዙር አሸናፊ የለም 😶',
    'win.cartela': 'ካርቴላ ~ {n}',
    'win.full': 'ሙሉ ካርቴላ',
    'win.corners': 'አራቱ ማዕዘኖች',
    'win.line': 'መስመር',
    'win.prize': '{amount} ሽልማት',
    'win.you': 'እርስዎ አሸንፈዋል! 🏆',
    'win.numbers': '{numbers} · በ{call}ኛው ጥሪ',
    'win.refunded': '{n} ቁጥሮች ተጠርተዋል። መደቡ ተመልሷል።',
    'win.again': 'እንደገና ይጫወቱ',
    'win.leaveRoom': 'ከክፍሉ ይውጡ',

    // ----- wallet -----
    'wallet.title': 'ዋሌት',
    'wallet.available': 'ቀሪ ሂሳብ',
    'wallet.held': '{amount} ለወጪ ጥያቄ ተይዟል',
    'wallet.waitingPayment': 'የክፍያ ማረጋገጫ በመጠበቅ ላይ…',
    'wallet.sendToPlayer': 'በስልክ ቁጥር ለሌላ ተጫዋች ይላኩ',
    'wallet.short': 'የ{table} ጠረጴዛ ለመግባት ቢያንስ {amount} ያስገቡ።',
    'wallet.tab.deposit': 'ያስገቡ',
    'wallet.tab.cashout': 'ያውጡ',
    'wallet.mode.transfer': 'ዝውውር + ደረሰኝ',
    'wallet.mode.online': 'ኦንላይን ይክፈሉ',
    'wallet.soonTitle': 'ገቢ ማድረግ በቅርቡ ይጀምራል',
    'wallet.soonBody': 'የቴሌብር ሂሳቦቻችን በመዘጋጀት ላይ ናቸው። ከጥቂት ጊዜ በኋላ ይመለሱ።',
    'wallet.bankAccounts': 'የባንክ ሂሳቦች',
    'wallet.accountName': 'ስም፦',
    'wallet.copy': 'ቅዳ',
    'wallet.copied': 'ተቀድቷል ✓',
    'wallet.copyFailed': 'መቅዳት አልተቻለም። ቁጥሩን ተጭነው በመያዝ ይቅዱ።',
    'wallet.sendInstruction': 'ገንዘቡን ወደ ቀዱት ሂሳብ{account} ይላኩ፣ ከዚያ የደረሰኝ ቁጥሩን ከታች ይለጥፉ።',
    'wallet.amountSent': 'የላኩት መጠን',
    'wallet.amountSentAria': 'የተላከ መጠን',
    'wallet.receiptId': 'የደረሰኝ / የግብይት ቁጥር',
    'wallet.receiptIdAria': 'የግብይት ቁጥር',
    'wallet.paste': 'ለጥፍ',
    'wallet.pasteFailed': 'ቁጥሩን በሳጥኑ ውስጥ ይለጥፉ (ክሊፕቦርድ መጠቀም አልተፈቀደም)።',
    'wallet.payerPhone': 'የላኩበት ስልክ',
    'wallet.payerName': 'በደረሰኙ ላይ ያለው ስም',
    'wallet.senderName': 'የላኪ ስም',
    'wallet.limits': 'ዝቅተኛ {min} · ከፍተኛ {max} {currency}',
    'wallet.transferHelp': '{limits}። የቴሌብር ደረሰኞች በራስ-ሰር ይረጋገጣሉ፤ ሌሎቹን ቡድናችን ያረጋግጣል። ቁጥሩ በስህተት ከተጻፈ ስልኩ እና ስሙ ዝውውርዎን ለማግኘት ይረዱናል።',
    'wallet.fee': '{percent}% ኮሚሽን',
    'wallet.youReceive': 'የሚደርስዎ',
    'wallet.submitting': 'በመላክ ላይ…',
    'wallet.confirmTransfer': 'ዝውውሬን አረጋግጥ',
    'wallet.amountAria': 'መጠን',
    'wallet.startingPayment': 'ክፍያ በመጀመር ላይ…',
    'wallet.pay': '{amount} ይክፈሉ',
    'wallet.cashout.title': 'ገንዘብ ያውጡ',
    'wallet.cashout.help': 'መጠኑ ወዲያውኑ ከሂሳብዎ ይያዛል፤ ከጸደቀ በኋላ ይከፈልዎታል፣ ብዙ ጊዜ በአንድ ቀን ውስጥ።',
    'wallet.cashout.from': 'ክፍያው የሚላከው ከዚህ ሂሳብ ነው፦ {account}።',
    'wallet.cashout.which': 'ገንዘቡ በየትኛው የ{method} ቁጥር ይላክ?',
    'wallet.cashout.accountAria': 'ክፍያ የሚላክበት የ{method} ቁጥር',
    'wallet.cashout.useMine': 'የእኔን ቁጥር ተጠቀም {phone}',
    'wallet.cashout.willSend': 'ከጸደቀ በኋላ {amount} ወደ {method} {account} ይላካል።',
    'wallet.cashout.amountAria': 'የሚወጣ መጠን',
    'wallet.cashout.request': '{amount} ያውጡ',
    'wallet.cashout.pending': 'ማጽደቅ በመጠበቅ ላይ',
    'wallet.cashout.cancel': 'ሰርዝ',
    'wallet.notice.depositVerified': 'ደረሰኝ {ref} ተረጋግጧል። {amount} ወደ ዋሌትዎ ገብቷል።',
    'wallet.notice.depositSubmitted': 'ደረሰኝ {ref} ተልኳል። ዝውውሩ እንደተረጋገጠ ገንዘቡ ወደ ዋሌትዎ ይገባል፣ ብዙ ጊዜ በደቂቃዎች ውስጥ።',
    'wallet.notice.cashoutRequested': 'የ{amount} ወጪ ጥያቄ ተልኳል። ከጸደቀ በኋላ {payout} ይደርስዎታል።',
    'wallet.notice.cashoutCancelled': 'የወጪ ጥያቄው ተሰርዞ ገንዘቡ ወደ ዋሌትዎ ተመልሷል።',
    'wallet.activity': 'የቅርብ ጊዜ እንቅስቃሴ',
    'wallet.noActivity': 'እስካሁን ምንም እንቅስቃሴ የለም።',
    'wallet.ledgerFee': '{amount} − {fee} ኮሚሽን',
    'status.paid': 'ተከፍሏል',
    'status.pending': 'በሂደት ላይ',
    'status.failed': 'አልተሳካም',
    'status.cancelled': 'ተሰርዟል',
    'status.rejected': 'ውድቅ ሆኗል',
    'method.telebirr.label': 'ቴሌብር',
    'method.telebirr.desc': 'የኢትዮ ቴሌኮም ሞባይል ገንዘብ',
    'method.cbebirr.label': 'ሲቢኢ ብር',
    'method.cbebirr.desc': 'የኢትዮጵያ ንግድ ባንክ',
    'method.boa.label': 'አቢሲኒያ ባንክ',
    'method.boa.desc': 'የአቢሲኒያ ባንክ ሂሳብ / ካርድ',

    // ----- send money -----
    'transfer.title': 'ገንዘብ ይላኩ',
    'transfer.available': 'መላክ የሚችሉት',
    'transfer.heading': 'ለሌላ ተጫዋች ያስተላልፉ',
    'transfer.help': 'ተጫዋቹ የተመዘገበበትን ስልክ ቁጥር ያስገቡ። ገንዘቡ ያለ ኮሚሽን ወዲያውኑ ከዋሌት ወደ ዋሌት ይተላለፋል።',
    'transfer.phoneLabel': 'የተቀባይ ስልክ ቁጥር',
    'transfer.phoneAria': 'የተቀባይ ስልክ',
    'transfer.minPlaceholder': 'ዝቅተኛ {n}',
    'transfer.amountAria': 'የሚላክ መጠን',
    'transfer.sent': '{amount} ለ{name} ({phone}) ተልኳል።',
    'transfer.send': '{amount} ይላኩ',
    'transfer.sendTo': '{amount} ለ{name} ይላኩ',
    'transfer.recent': 'የቅርብ ጊዜ ዝውውሮች',
    'transfer.none': 'እስካሁን ምንም ዝውውር የለም።',

    // ----- profile -----
    'profile.title': 'ፕሮፋይል',
    'profile.signedUp': '✓ ተመዝግበዋል',
    'profile.incomplete': '! ምዝገባ አልተጠናቀቀም',
    'profile.finishLead': 'ምዝገባዎን ያጠናቅቁ።',
    'profile.finishBody': 'ስምዎን እና ስልክ ቁጥርዎን ከታች ያስገቡ፣ ወይም ለቦቱ {command} ይላኩ።',
    'profile.stat.games': 'ጨዋታዎች',
    'profile.stat.wins': 'ድሎች',
    'profile.stat.won': 'ያሸነፉት',
    'profile.fields': 'የፕሮፋይል መረጃ',
    'profile.displayName': 'የሚታይ ስም',
    'profile.displayNameHint': 'ሌሎች ተጫዋቾች የሚያዩት ስም',
    'profile.phone': 'ስልክ ቁጥር',
    'profile.telegram': 'ቴሌግራም',
    'profile.signedUpAt': 'የተመዘገቡበት ቀን',
    'profile.saved': 'ተቀምጧል ✓',
    'profile.saving': 'በማስቀመጥ ላይ…',
    'profile.save': 'ፕሮፋይል ያስቀምጡ',
    'profile.logout': 'ይውጡና ይዝጉ',
    'profile.language': 'Language / ቋንቋ',

    // ----- missions -----
    'missions.title': 'ተልዕኮዎች',
    'missions.resetIn': 'ዕለታዊ ተልዕኮዎች በ{time} ውስጥ ይታደሳሉ።',
    'missions.ready': '{n} ሽልማት ለመቀበል ዝግጁ ነው!',
    'missions.readyMany': '{n} ሽልማቶች ለመቀበል ዝግጁ ናቸው!',
    'missions.reward': 'ሽልማት',
    'missions.done': 'ተቀብለዋል ✓',
    'missions.claim': 'ይቀበሉ',
    'mission.play3.title': '3 ዙር ይጫወቱ',
    'mission.win1.title': 'አንድ ዙር ያሸንፉ',
    'mission.mark50.title': '50 ቁጥሮች ምልክት ያድርጉ',
    'mission.paid1.title': 'በክፍያ ጠረጴዛ ይጫወቱ',

    // ----- shop -----
    'shop.title': 'ሱቅ',
    'shop.earn': 'ኮይኖችን ከ{missions} ያግኙ። ኮይን ወደ ብር አይቀየርም።',
    'shop.earnLink': 'ተልዕኮዎች',
    'shop.skins': 'የካርቴላ ገጽታዎች',
    'shop.classic': 'መደበኛ ካርቴላ',
    'shop.inUse': 'በጥቅም ላይ ✓',
    'shop.use': 'ይጠቀሙ',
    'shop.boosters': 'ቡስተሮች',
    'shop.history': 'የኮይን ታሪክ',
    'shop.theme_emerald.title': 'ኤመራልድ ካርቴላ',
    'shop.theme_emerald.desc': 'አረንጓዴ እና ወርቃማ ገጽታ',
    'shop.theme_sunset.title': 'የጀምበር ካርቴላ',
    'shop.theme_sunset.desc': 'ብርቱካናማ እና ሮዝ ገጽታ',
    'shop.theme_neon.title': 'ኒዮን ካርቴላ',
    'shop.theme_neon.desc': 'ውሃ ሰማያዊ እና ሐምራዊ ገጽታ',
    'shop.theme_gold.title': 'ወርቃማ ካርቴላ',
    'shop.theme_gold.desc': 'የVIP ገጽታ',

    // ----- server errors -----
    'err.insufficientRoom': 'በቂ ሂሳብ የለዎትም፦ ይህ ጠረጴዛ በካርቴላ {stake} ብር ያስከፍላል',
    'err.insufficientHave': 'በቂ ሂሳብ የለዎትም፦ ያለዎት {amount} ነው',
    'err.insufficient': 'በቂ ሂሳብ የለዎትም',
    'err.gameRunning': 'ጨዋታው ተጀምሯል',
    'err.roomFull': 'ጠረጴዛው ሞልቷል',
    'err.waitToPick': 'ካርቴላ ለመምረጥ ቀጣዩን ዙር ይጠብቁ',
    'err.waitToChange': 'ካርቴላ ለመቀየር ቀጣዩን ዙር ይጠብቁ',
    'err.notInRoom': 'በጠረጴዛ ውስጥ አይደሉም',
    'err.notInRound': 'በዚህ ዙር ውስጥ አይደሉም',
    'err.pickBetween': 'ከ1 እስከ {max} ያለ ካርቴላ ይምረጡ',
    'err.cartelaTaken': 'ካርቴላ {n} በ{name} ተይዟል',
    'err.maxCartelas': 'እስከ {max} ካርቴላ ብቻ መያዝ ይችላሉ',
    'err.notYourCartela': 'ካርቴላ {n} የእርስዎ አይደለም',
    'err.needPlayers': 'ቢያንስ {n} ካርቴላ የያዙ ተጫዋቾች ያስፈልጋሉ',
    'err.noGame': 'አሁን የሚካሄድ ጨዋታ የለም',
    'err.notCalled': 'ያ ቁጥር ገና አልተጠራም',
    'err.notOnCards': 'ያ ቁጥር በካርቴላዎ ላይ የለም',
    'err.notOnCartela': 'ያ ቁጥር በካርቴላ {n} ላይ የለም',
    'err.notYetFull': 'ገና ነው፦ {marked}/{total} ምልክት ተደርጓል',
    'err.notYetLine': 'ገና ነው፦ አንድ ረድፍ፣ አምድ፣ ሰያፍ መስመር ወይም አራቱን ማዕዘኖች ይሙሉ ({marked}/{total} ምልክት ተደርጓል)',
    'err.roomNotFound': 'ጠረጴዛው አልተገኘም',
    'err.unknownStake': 'ያልታወቀ መደብ',
    'err.tableClosed': 'ይህ ጠረጴዛ በኦፕሬተሩ ተዘግቷል',
    'err.requestFailed': 'ጥያቄው አልተሳካም',
    'err.requestFailedCode': 'ጥያቄው አልተሳካም ({code})',
    'err.openFromTelegram': 'ኦንላይን ለመጫወት ጨዋታውን ከቴሌግራም ይክፈቱ።',
    'err.suspendedUntil': 'መለያዎ እስከ {date} ታግዷል{reason}',
    'err.suspendedForever': 'መለያዎ በቋሚነት ታግዷል{reason}',
    'err.suspended': 'መለያዎ ታግዷል{reason}',
    'err.suspendedByOperator': 'በኦፕሬተሩ ታግዷል',
    'err.amountBetween': 'መጠኑ ከ{min} እስከ {max} {currency} መሆን አለበት',
    'err.amountPositive': 'መጠኑ ከዜሮ በላይ መሆን አለበት',
    'err.minTransfer': 'ዝቅተኛው የዝውውር መጠን {min} {currency} ነው',
    'err.unknownMethod': 'ያልታወቀ የክፍያ መንገድ',
    'err.paymentStart': 'ክፍያውን መጀመር አልተቻለም። እባክዎ እንደገና ይሞክሩ።',
    'err.payerPhone': 'የላኩበት ስልክ ትክክለኛ ቁጥር አይመስልም፣ ለምሳሌ 0900000000 (ወይም ባዶ ይተዉት)',
    'err.methodNoTransfer': 'በዚህ መንገድ ዝውውር አንቀበልም',
    'err.validPhone': 'ትክክለኛ ስልክ ቁጥር ያስገቡ፣ ለምሳሌ 0900000000',
    'err.noSuchPlayer': 'በዚህ ስልክ ቁጥር የተመዘገበ ተጫዋች የለም',
    'err.ownNumber': 'ይህ የራስዎ ቁጥር ነው',
    'err.sendToSelf': 'ለራስዎ ገንዘብ መላክ አይችሉም',
    'err.payoutPhone': 'ክፍያ የሚላክበትን የ{method} ስልክ ቁጥር ያስገቡ፣ ለምሳሌ 0900000000',
    'err.payoutOnly': 'ወጪ የሚከፈለው በ{method} ብቻ ነው',
    'err.payoutAccount': 'ክፍያ የሚላክበትን ስልክ ወይም የሂሳብ ቁጥር ያስገቡ',
    'err.notFound': 'አልተገኘም',
    'err.receiptFormat': 'የግብይት / የደረሰኝ ቁጥሩን በደረሰኙ ላይ እንዳለ በትክክል ያስገቡ (6–32 ፊደላትና ቁጥሮች)',
    'err.receiptUsed': 'ይህ የግብይት ቁጥር ከዚህ በፊት ገብቷል',
    'err.withdrawalAlready': 'የወጪ ጥያቄው አስቀድሞ {status}',
    'err.nameLength': 'ስሙ ከ{min}–{max} ፊደላት መሆን አለበት',
    'err.phoneDigits': 'ስልኩ 7–15 አሃዞች መሆን አለበት፣ ለምሳሌ +251900000000',
    'err.nothingToUpdate': 'የሚቀየር ነገር የለም',
    'err.notEnoughCoins': 'በቂ ኮይን የለዎትም፦ {need} ያስፈልጋል፣ ያለዎት {have} ነው',
    'err.bonusClaimed': 'የዛሬውን ቦነስ ወስደዋል። ነገ ይመለሱ!',
    'err.missionClaimed': 'የዚህ ተልዕኮ ሽልማት ተወስዷል',
    'err.missionNotDone': 'ገና አልተጠናቀቀም፦ {progress}/{goal}',
    'err.skinOwned': 'ይህ ገጽታ አስቀድሞ የእርስዎ ነው',
    'err.skinNotOwned': 'ይህ ገጽታ የእርስዎ አይደለም',

    // ----- ledger notes written by the server -----
    'note.stake': 'የካርቴላ {n} መደብ · ክፍል {code}',
    'note.refund': 'የካርቴላ {n} ተመላሽ · ክፍል {code}',
    'note.prize': 'ሽልማት · ክፍል {code}',
    'note.adjustment': 'በ USA ቢንጎ የተስተካከለ፦ {reason}',
    'note.transfer': 'ዝውውር {detail}',
    'note.deposit': 'በ{method} ዝውውር፣ ደረሰኝ {ref}',
    'note.cashout': 'ወጪ ወደ {method} {account}',
    'note.cancelledByPlayer': 'በተጫዋቹ ተሰርዟል',
    'note.notConfirmed': 'ዝውውሩ ሊረጋገጥ አልቻለም',
    'note.dailyBonus': 'ዕለታዊ ቦነስ · ቀን {day}',
    'note.mission': 'ተልዕኮ · {title}',
    'note.shop': 'ሱቅ · {title}',
    'note.wonFree': 'ነፃ ቢንጎ አሸንፈዋል',
  },
};

const isLang = (value) => Object.hasOwn(STRINGS, value);

/** `?lang=` from the launch link first, then this device's choice, then Amharic. */
function initialLang() {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  try {
    const requested = new URLSearchParams(window.location.search).get('lang');
    if (isLang(requested)) return requested;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_LANG;
}

let lang = initialLang();
if (typeof document !== 'undefined') document.documentElement.lang = lang;
const listeners = new Set();

export const getLang = () => lang;

export function setLang(next) {
  if (!isLang(next) || next === lang) return;
  lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  for (const notify of listeners) notify();
}

const subscribe = (notify) => {
  listeners.add(notify);
  return () => listeners.delete(notify);
};

const fill = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (slot, name) => (name in vars ? String(vars[name]) : slot)) : text);

/** The text of `key` in the current language (English, then the key itself, when missing); `{name}` slots come from `vars`. */
export function t(key, vars) {
  return fill(STRINGS[lang][key] ?? STRINGS.en[key] ?? key, vars);
}

/** `[before, after]` of a translation around its `{slot}`, so JSX can put an element (bold text, a link) there. */
export function tSplit(key, slot, vars) {
  const [before, after = ''] = t(key, vars).split(`{${slot}}`);
  return [before, after];
}

/** Text the server sends in English (mission, shop and payment method names), translated by id when we can. */
export function tServer(key, text) {
  return lang === 'en' ? text || t(key) : STRINGS[lang][key] ?? text;
}

/** Subscribes the component to language changes and returns `t`. */
export function useT() {
  useSyncExternalStore(subscribe, getLang, getLang);
  return t;
}

/** `[lang, setLang]`, re-rendering on change. */
export function useLang() {
  return [useSyncExternalStore(subscribe, getLang, getLang), setLang];
}

/** "ETB" is "ብር" in Amharic; any other currency code is shown as it is. */
export const currencyLabel = (code = 'ETB') => (code === 'ETB' ? t('common.etb') : code);
/** 50 -> "50 ETB" / "50 ብር"; cents only when there are any. */
export const etb = (n) => `${Number(n ?? 0).toFixed(n % 1 ? 2 : 0)} ${currencyLabel()}`;

/* ---------- English text written by the server ---------- */

const englishKeyOf = (prefix, text) => Object.keys(STRINGS.en).find((key) => key.startsWith(prefix) && STRINGS.en[key] === text);
/** "Telebirr" or "telebirr" -> "ቴሌብር"; an unknown method stays as it is. */
const methodName = (name) => {
  const key = englishKeyOf('method.', name) ?? `method.${name}.label`;
  return key in STRINGS.en ? t(key) : name;
};
/** A mission or shop title as the server wrote it into a coin note. */
const titleName = (title) => {
  const key = englishKeyOf('mission.', title) ?? englishKeyOf('shop.', title);
  return key ? t(key) : title;
};

/** [pattern, key, match -> vars]. First match wins, so the specific patterns come first. */
export const ERROR_RULES = [
  [/^Insufficient balance: this room costs (\S+) per cartela$/, 'err.insufficientRoom', (m) => ({ stake: m[1] })],
  [/^Insufficient balance: you have (\S+) (\S+)$/, 'err.insufficientHave', (m) => ({ amount: `${m[1]} ${currencyLabel(m[2])}` })],
  [/^Insufficient balance/, 'err.insufficient'],
  [/^Game already (in progress|running)$/, 'err.gameRunning'],
  [/^Room is full$/, 'err.roomFull'],
  [/^Wait for the next round to pick a cartela$/, 'err.waitToPick'],
  [/^Wait for the next round to change cartelas$/, 'err.waitToChange'],
  [/^You are not in (a|this) room$/, 'err.notInRoom'],
  [/^You are not in this round$/, 'err.notInRound'],
  [/^Pick a cartela between 1 and (\d+)$/, 'err.pickBetween', (m) => ({ max: m[1] })],
  [/^Cartela (\d+) is already taken by (.*)$/, 'err.cartelaTaken', (m) => ({ n: m[1], name: m[2] })],
  [/^You can hold up to (\d+) cartelas$/, 'err.maxCartelas', (m) => ({ max: m[1] })],
  [/^You do not hold cartela (\d+)$/, 'err.notYourCartela', (m) => ({ n: m[1] })],
  [/^Need at least (\d+) players with a cartela$/, 'err.needPlayers', (m) => ({ n: m[1] })],
  [/^No game running$/, 'err.noGame'],
  [/^That number has not been called$/, 'err.notCalled'],
  [/^That number is not on your cards$/, 'err.notOnCards'],
  [/^That number is not on cartela (\d+)$/, 'err.notOnCartela', (m) => ({ n: m[1] })],
  [/^Not yet: (\d+)\/(\d+) marked$/, 'err.notYetFull', (m) => ({ marked: m[1], total: m[2] })],
  [/^Not yet: .*\((\d+)\/(\d+) marked\)$/, 'err.notYetLine', (m) => ({ marked: m[1], total: m[2] })],
  [/^Room not found$/, 'err.roomNotFound'],
  [/^Unknown stake$/, 'err.unknownStake'],
  [/^This table was closed by the operator$/, 'err.tableClosed'],
  [/^Request failed$/, 'err.requestFailed'],
  [/^Request failed \((\d+)\)$/, 'err.requestFailedCode', (m) => ({ code: m[1] })],
  [/^(Open this game from Telegram to play online\.|unauthorized|Invalid or missing Telegram initData)$/, 'err.openFromTelegram'],
  [/^Account suspended until (\S+?)(?:: (.*))?$/, 'err.suspendedUntil', (m) => ({ date: m[1], reason: m[2] ? `: ${tError(m[2])}` : '' })],
  [/^Account suspended permanently(?:: (.*))?$/, 'err.suspendedForever', (m) => ({ reason: m[1] ? `: ${tError(m[1])}` : '' })],
  [/^Account suspended(?:: (.*))?$/, 'err.suspended', (m) => ({ reason: m[1] ? `: ${tError(m[1])}` : '' })],
  [/^Suspended by operator$/, 'err.suspendedByOperator'],
  [/^Amount must be between (\S+) and (\S+) (\S+)$/, 'err.amountBetween', (m) => ({ min: m[1], max: m[2], currency: currencyLabel(m[3]) })],
  [/^Amount must be positive$/, 'err.amountPositive'],
  [/^Minimum transfer is (\S+) (\S+)$/, 'err.minTransfer', (m) => ({ min: m[1], currency: currencyLabel(m[2]) })],
  [/^Unknown (payment |payout )?method$/, 'err.unknownMethod'],
  [/^Could not start payment\. Please try again\.$/, 'err.paymentStart'],
  [/^The phone you sent from does not look like a phone number/, 'err.payerPhone'],
  [/^Transfers are not accepted through this method$/, 'err.methodNoTransfer'],
  [/^Enter a valid phone number/, 'err.validPhone'],
  [/^No player with that phone number has signed up yet$/, 'err.noSuchPlayer'],
  [/^That is your own number$/, 'err.ownNumber'],
  [/^You cannot send money to yourself$/, 'err.sendToSelf'],
  [/^Enter the (.+) phone number to pay out to/, 'err.payoutPhone', (m) => ({ method: methodName(m[1]) })],
  [/^Cash-outs are paid by (.+) only$/, 'err.payoutOnly', (m) => ({ method: methodName(m[1]) })],
  [/^Enter the phone or account number to pay out to$/, 'err.payoutAccount'],
  [/^(Not|Withdrawal not|Deposit not) found$/, 'err.notFound'],
  [/^Enter the transaction \/ receipt id exactly as shown/, 'err.receiptFormat'],
  [/^This transaction id has already been submitted$/, 'err.receiptUsed'],
  [/^Withdrawal already (\w+)$/, 'err.withdrawalAlready', (m) => ({ status: tServer(`status.${m[1]}`, m[1]) })],
  [/^Name must be (\d+)–(\d+) characters$/, 'err.nameLength', (m) => ({ min: m[1], max: m[2] })],
  [/^Phone must be 7–15 digits/, 'err.phoneDigits'],
  [/^Nothing to update$/, 'err.nothingToUpdate'],
  [/^Not enough coins: you need (\d+), you have (\d+)$/, 'err.notEnoughCoins', (m) => ({ need: m[1], have: m[2] })],
  [/^Daily bonus already claimed/, 'err.bonusClaimed'],
  [/^Mission reward already claimed$/, 'err.missionClaimed'],
  [/^Not finished yet: (\d+)\/(\d+)$/, 'err.missionNotDone', (m) => ({ progress: m[1], goal: m[2] })],
  [/^You already own this skin$/, 'err.skinOwned'],
  [/^You do not own this skin$/, 'err.skinNotOwned'],
  // What the browser and socket.io say when the network is down.
  [/^(Failed to fetch|Load failed|NetworkError.*|timeout|websocket error|xhr poll error|xhr post error)$/, 'common.network'],
];

/** Wallet and coin ledger notes, and the reasons the server attaches to a refused transaction. */
export const NOTE_RULES = [
  [/^Stake for cartela (\d+) in room (\S+)$/, 'note.stake', (m) => ({ n: m[1], code: m[2] })],
  [/^Refund for cartela (\d+) in room (\S+)$/, 'note.refund', (m) => ({ n: m[1], code: m[2] })],
  [/^Prize for room (\S+)$/, 'note.prize', (m) => ({ code: m[1] })],
  [/^Operator adjustment: (.+)$/, 'note.adjustment', (m) => ({ reason: m[1] })],
  [/^Transfer via (\S+), receipt (\S+)$/, 'note.deposit', (m) => ({ method: methodName(m[1]), ref: m[2] })],
  [/^Transfer could not be confirmed$/, 'note.notConfirmed'],
  [/^Transfer (.+ → .+)$/, 'note.transfer', (m) => ({ detail: m[1] })],
  [/^Cash out to (\S+) (.+)$/, 'note.cashout', (m) => ({ method: methodName(m[1]), account: m[2] })],
  [/^Cancelled by player$/, 'note.cancelledByPlayer'],
  [/^Daily bonus · day (\d+)$/, 'note.dailyBonus', (m) => ({ day: m[1] })],
  [/^Mission · (.+)$/, 'note.mission', (m) => ({ title: titleName(m[1]) })],
  [/^Shop · (.+)$/, 'note.shop', (m) => ({ title: titleName(m[1]) })],
  [/^Won Free Bingo$/, 'note.wonFree'],
];

function applyRules(rules, message) {
  if (lang === 'en' || typeof message !== 'string' || !message) return message;
  for (const [pattern, key, vars] of rules) {
    const match = message.match(pattern);
    if (match) return t(key, vars?.(match));
  }
  return message;
}

/** An error message from the server or socket, in Amharic when we know it; otherwise as it came. */
export function tError(message) {
  return applyRules(ERROR_RULES, message);
}

/** Same for a ledger note or a transaction's reason. */
export function tNote(note) {
  return applyRules(NOTE_RULES, note);
}
