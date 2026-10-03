/**
 * Everything the bot says, in Amharic (the default) and English. `t(lang, key, vars)` fills
 * `{placeholders}`; a key missing from a language falls back to English, then to the key.
 * Texts are Telegram (legacy) Markdown: escape player-supplied values with `md()` before
 * passing them in.
 */
export const LANGS = Object.freeze(['am', 'en']);
export const DEFAULT_LANG = 'am';
export const LANG_NAMES = Object.freeze({ am: 'አማርኛ', en: 'English' });

export const langOf = (user) => (LANGS.includes(user?.lang) ? user.lang : DEFAULT_LANG);

/** Escapes what Telegram's (legacy) Markdown would read as formatting; usernames are full of underscores. */
export const md = (text) => String(text ?? '').replace(/([_*`[])/g, '\\$1');

const STRINGS = {
  en: {
    // main menu
    'menu.play': '🎮 Play Bingo',
    'menu.wallet': '💵 Wallet',
    'menu.send': '💸 Send money',
    'menu.profile': '👤 Profile',
    'menu.howto': '❓ How to play',
    'menu.deposit': '💳 Deposit',
    'menu.withdraw': '🏧 Cash out',
    'menu.language': '🌐 አማርኛ',
    'menu.ready': 'Ready when you are 👇',
    'menu.open': 'Tap below to open the Bingo Mini App 👇',
    'menu.welcomeBack': '👋 Welcome back, *{name}*!\n\nPress *Play Bingo* to open the game. Send /help to see everything I can do.',
    'menu.fallback': 'Send /start to get the Play button, or /help for the list of commands.',
    'menu.contactThanks': 'Thanks! Use *My profile* to update your number.',

    // sign-up
    'signup.name': '👋 Welcome to *USA Bingo*! Two quick steps and you are in.\n\n*Step 1 of 2 · your username*\nThis is the name other players see at the table.\nTap a suggestion below, or type your own ({min}–{max} characters).',
    'signup.phone': 'Nice to meet you, *{name}*!\n\n*Step 2 of 2 · your phone number*\nShare your phone number so deposits, cash-outs and transfers are matched to your account.\nTap the button below, or type it (e.g. +2519…).',
    'signup.done': '✅ You are registered, *{name}*!\n{phoneLine}\n\nPress *Play Bingo* to open the game.',
    'signup.donePhone': '📱 {phone}',
    'signup.doneNoPhone': '📱 No phone yet — add it later from *My profile*.',
    'signup.nameInvalid': 'That username will not work. Use {min}–{max} characters with at least one letter, or tap a suggestion below.',
    'signup.nameFirst': 'First choose your username: tap a suggestion below or type one.',
    'signup.phoneInvalid': 'That does not look like a phone number. Tap *Share my number* or type it like +251900000000.',
    'signup.ownContact': 'Please share *your own* contact.',
    'signup.share': '📱 Share my number',
    'signup.skip': 'Skip for now',

    // profile
    'profile.none': 'You are not registered yet. Send /start to sign up.',
    'profile.telegram': 'Telegram: @{username}',
    'profile.phone': 'Phone: {phone}',
    'profile.noPhone': '— not added',
    'profile.signedUp': 'Signed up: {date}',
    'profile.unfinished': '⚠️ Sign-up not finished',
    'profile.open': '👤 Open profile',
    'profile.updatePhone': '📱 Update phone number',
    'profile.finish': '📝 Finish sign-up',

    // help commands
    'help.title': '🎱 *USA Bingo · what I can do*',
    'help.list': '/play — open the game\n/balance — your wallet balance\n/deposit — how to add money\n/withdraw — how to cash out\n/rules — how the game works\n/profile — your name and phone\n/language — አማርኛ / English\n/contact — talk to support',
    'rules.text':
      '📜 *How to play*\n\n1. Press *Play Bingo* and pick a table ({stakes} ETB entry from your wallet).\n2. Pick up to {maxCartelas} cartelas (1–{cartelaCount}) before the {countdown} s timer runs out; each one pays the entry.\n3. Numbers are called one by one, in Amharic. Tap them on your card, or leave *AUTO* on and they mark themselves.\n4. Press *BINGO!* as soon as one cartela has a full row, column, diagonal or all four corners.\n5. The first correct BINGO takes the prize, up to {maxPrize} ETB a round. 🏆\n\nIf nobody wins, every stake is returned.',
    'balance.text': '💵 *Your wallet:* {balance} ETB',
    'balance.low': 'That is below the cheapest table ({stake} ETB). Send /deposit to top up.',
    'deposit.title': '💳 *How to deposit*',
    'deposit.steps': '1. Send the money with Telebirr to one of our accounts:\n{accounts}\n2. Open *Wallet → Deposit* in the game.\n3. Enter the amount and only the *Transaction No* from the Telebirr message (for example `DEI559JRN`).\n\nThe receipt is checked automatically and your wallet is credited.',
    'deposit.account': '   • `{account}` — {name}',
    'deposit.noAccounts': '   • open *Wallet → Deposit* in the game to see the account',
    'deposit.limits': 'Minimum {min} ETB · deposit fee {fee}%',
    'deposit.warning': '⚠️ Only ever pay the numbers shown here or inside the game. We never ask for money, a PIN or a password in a private message.',
    'withdraw.title': '🏧 *How to cash out*',
    'withdraw.steps': '1. Open *Wallet → Cash out* in the game.\n2. Enter the amount and the Telebirr number to receive it.\n3. Once approved, the money is sent to your Telebirr and the bot messages you.',
    'withdraw.limits': 'Minimum {min} ETB · service fee {fee}%',
    'withdraw.send': 'To give money to a friend instead, use *Send money*: it arrives in their wallet at once.',
    'contact.text': '📞 *Support*\n\n{lines}\n\nTell us your player ID `{id}` so we can find your account.',
    'contact.support': 'Questions and payments: @{support}',
    'contact.channel': 'News and winners: @{channel}',
    'contact.none': 'Our support contact will be announced here soon. Meanwhile /deposit, /withdraw and /rules answer the common questions.',
    'language.ask': '🌐 Choose your language · ቋንቋ ይምረጡ',
    'language.set': '✅ Language set to *English*.',
    'server.down': 'I could not reach the game server just now. Please try again in a minute.',

    // command menu (the "/" list in Telegram)
    'cmd.start': 'Sign up and get the Play button',
    'cmd.play': 'Open the Bingo game',
    'cmd.balance': 'Your wallet balance',
    'cmd.deposit': 'How to add money',
    'cmd.withdraw': 'How to cash out',
    'cmd.rules': 'How the game works',
    'cmd.profile': 'Your name and phone',
    'cmd.language': 'አማርኛ / English',
    'cmd.contact': 'Talk to support',
    'cmd.help': 'Everything I can do',
  },

  am: {
    'menu.play': '🎮 ቢንጎ ይጫወቱ',
    'menu.wallet': '💵 ዋሌት',
    'menu.send': '💸 ገንዘብ ይላኩ',
    'menu.profile': '👤 ፕሮፋይል',
    'menu.howto': '❓ አጨዋወት',
    'menu.deposit': '💳 ገንዘብ ማስገቢያ',
    'menu.withdraw': '🏧 ገንዘብ ማውጫ',
    'menu.language': '🌐 English',
    'menu.ready': 'ዝግጁ ሲሆኑ ይጀምሩ 👇',
    'menu.open': 'ጨዋታውን ለመክፈት ከታች ይጫኑ 👇',
    'menu.welcomeBack': '👋 እንኳን ደህና ተመለሱ፣ *{name}*!\n\nጨዋታውን ለመክፈት *ቢንጎ ይጫወቱ* የሚለውን ይጫኑ። ማድረግ የምችለውን ሁሉ ለማየት /help ይላኩ።',
    'menu.fallback': 'የመጫወቻ ቁልፉን ለማግኘት /start ይላኩ፣ ወይም የትዕዛዞችን ዝርዝር ለማየት /help።',
    'menu.contactThanks': 'እናመሰግናለን! ቁጥርዎን ለመቀየር *ፕሮፋይል* ይጠቀሙ።',

    'signup.name': '👋 እንኳን ወደ *USA ቢንጎ* በደህና መጡ! ሁለት አጭር ደረጃ ብቻ ነው።\n\n*ደረጃ 1/2 · የመጠሪያ ስምዎ*\nይህ በጠረጴዛው ላይ ሌሎች ተጫዋቾች የሚያዩት ስም ነው።\nከታች ካሉት አንዱን ይጫኑ፣ ወይም የራስዎን ይጻፉ ({min}–{max} ፊደል)።',
    'signup.phone': 'እንኳን ደህና መጡ፣ *{name}*!\n\n*ደረጃ 2/2 · ስልክ ቁጥርዎ*\nያስገቡት፣ ያወጡት እና የላኩት ገንዘብ ከአካውንትዎ ጋር እንዲገናኝ ስልክ ቁጥርዎን ያጋሩ።\nከታች ያለውን ቁልፍ ይጫኑ፣ ወይም ቁጥሩን ይጻፉ (ለምሳሌ +2519…)።',
    'signup.done': '✅ ተመዝግበዋል፣ *{name}*!\n{phoneLine}\n\nጨዋታውን ለመክፈት *ቢንጎ ይጫወቱ* ይጫኑ።',
    'signup.donePhone': '📱 {phone}',
    'signup.doneNoPhone': '📱 ስልክ ቁጥር አልገባም — በኋላ ከ*ፕሮፋይል* ላይ ማስገባት ይችላሉ።',
    'signup.nameInvalid': 'ይህ ስም አይሰራም። ቢያንስ አንድ ፊደል ያለው ከ{min}–{max} ፊደል ይጠቀሙ፣ ወይም ከታች ካሉት አንዱን ይጫኑ።',
    'signup.nameFirst': 'መጀመሪያ የመጠሪያ ስምዎን ይምረጡ፦ ከታች ካሉት አንዱን ይጫኑ ወይም ይጻፉ።',
    'signup.phoneInvalid': 'ይህ ስልክ ቁጥር አይመስልም። *ቁጥሬን አጋራ* የሚለውን ይጫኑ፣ ወይም እንደ +251900000000 አድርገው ይጻፉ።',
    'signup.ownContact': 'እባክዎ *የራስዎን* ቁጥር ያጋሩ።',
    'signup.share': '📱 ቁጥሬን አጋራ',
    'signup.skip': 'ለአሁን ዝለል',

    'profile.none': 'ገና አልተመዘገቡም። ለመመዝገብ /start ይላኩ።',
    'profile.telegram': 'ቴሌግራም: @{username}',
    'profile.phone': 'ስልክ: {phone}',
    'profile.noPhone': '— አልገባም',
    'profile.signedUp': 'የተመዘገቡበት ቀን: {date}',
    'profile.unfinished': '⚠️ ምዝገባው አልተጠናቀቀም',
    'profile.open': '👤 ፕሮፋይል ክፈት',
    'profile.updatePhone': '📱 ስልክ ቁጥር ቀይር',
    'profile.finish': '📝 ምዝገባ ጨርስ',

    'help.title': '🎱 *USA ቢንጎ · ማድረግ የምችላቸው*',
    'help.list': '/play — ጨዋታውን ይክፈቱ\n/balance — የዋሌትዎ ቀሪ ሂሳብ\n/deposit — ገንዘብ እንዴት እንደሚያስገቡ\n/withdraw — ገንዘብ እንዴት እንደሚያወጡ\n/rules — የጨዋታው ሕግ\n/profile — ስምዎ እና ስልክዎ\n/language — አማርኛ / English\n/contact — ድጋፍ ለማግኘት',
    'rules.text':
      '📜 *የጨዋታ ሕግ*\n\n1. *ቢንጎ ይጫወቱ* የሚለውን ይጫኑ እና ጠረጴዛ ይምረጡ (መግቢያ {stakes} ብር፣ ከዋሌትዎ ይቆረጣል)።\n2. የ{countdown} ሰከንድ ቆጠራው ከማለቁ በፊት እስከ {maxCartelas} ካርቴላ ይምረጡ (1–{cartelaCount})፤ እያንዳንዱ ካርቴላ መግቢያውን ይከፍላል።\n3. ቁጥሮች አንድ በአንድ በአማርኛ ይጠራሉ። ካርቴላዎ ላይ ያለውን ይንኩ፣ ወይም *AUTO* ን አብርተው ይተዉት — በራሱ ይመታል።\n4. አንድ ካርቴላ ላይ ሙሉ መስመር ወደ ጎን፣ ወደ ታች፣ ሰያፍ ወይም አራቱ ማዕዘኖች ሲሞሉ ወዲያውኑ *ቢንጎ!* ይጫኑ።\n5. መጀመሪያ በትክክል ቢንጎ ያለ ተጫዋች ሽልማቱን ይወስዳል፤ በአንድ ዙር እስከ {maxPrize} ብር። 🏆\n\nማንም ካላሸነፈ የሁሉም ተጫዋች ብር ይመለሳል።',
    'balance.text': '💵 *የዋሌትዎ ቀሪ ሂሳብ:* {balance} ብር',
    'balance.low': 'ይህ ከዝቅተኛው ጠረጴዛ ({stake} ብር) ያነሰ ነው። ለመሙላት /deposit ይላኩ።',
    'deposit.title': '💳 *ገንዘብ እንዴት ያስገባሉ?*',
    'deposit.steps': '1. በቴሌብር ወደ አንዱ አካውንታችን ገንዘቡን ይላኩ፦\n{accounts}\n2. ጨዋታው ውስጥ *ዋሌት → ያስገቡ* ይክፈቱ።\n3. መጠኑን እና ከቴሌብር መልእክቱ ላይ ያለውን *Transaction No* ብቻ (ለምሳሌ `DEI559JRN`) ያስገቡ።\n\nደረሰኙ በራሱ ይረጋገጣል፤ ዋሌትዎም ይሞላል።',
    'deposit.account': '   • `{account}` — {name}',
    'deposit.noAccounts': '   • አካውንቱን ለማየት ጨዋታው ውስጥ *ዋሌት → ያስገቡ* ይክፈቱ',
    'deposit.limits': 'ዝቅተኛ {min} ብር · የማስገቢያ ክፍያ {fee}%',
    'deposit.warning': '⚠️ ገንዘብ የሚላከው እዚህ ወይም ጨዋታው ውስጥ ወደሚታዩት ቁጥሮች ብቻ ነው። እኛ በግል መልእክት ገንዘብ፣ ፒን ወይም የይለፍ ቃል በፍጹም አንጠይቅም።',
    'withdraw.title': '🏧 *ገንዘብ እንዴት ያወጣሉ?*',
    'withdraw.steps': '1. ጨዋታው ውስጥ *ዋሌት → ያውጡ* ይክፈቱ።\n2. መጠኑን እና ገንዘቡ የሚገባበትን የቴሌብር ቁጥር ያስገቡ።\n3. ጥያቄዎ ከጸደቀ በኋላ ገንዘቡ ወደ ቴሌብርዎ ይላካል፤ ቦቱም መልእክት ይልክልዎታል።',
    'withdraw.limits': 'ዝቅተኛ {min} ብር · የአገልግሎት ክፍያ {fee}%',
    'withdraw.send': 'ለጓደኛዎ መስጠት ከፈለጉ *ገንዘብ ይላኩ* ይጠቀሙ፦ ወዲያውኑ ወደ ዋሌቱ ይገባል።',
    'contact.text': '📞 *ድጋፍ*\n\n{lines}\n\nአካውንትዎን በቀላሉ እንድናገኝ የተጫዋች መለያዎን `{id}` ይንገሩን።',
    'contact.support': 'ለጥያቄ እና ለክፍያ ጉዳይ: @{support}',
    'contact.channel': 'ዜና እና አሸናፊዎች: @{channel}',
    'contact.none': 'የድጋፍ አድራሻችን በቅርቡ እዚህ ይገለጻል። እስከዚያው /deposit፣ /withdraw እና /rules የተለመዱ ጥያቄዎችን ይመልሳሉ።',
    'language.ask': '🌐 ቋንቋ ይምረጡ · Choose your language',
    'language.set': '✅ ቋንቋው ወደ *አማርኛ* ተቀይሯል።',
    'server.down': 'አሁን የጨዋታ ሰርቨሩን ማግኘት አልቻልኩም። እባክዎ ከአንድ ደቂቃ በኋላ እንደገና ይሞክሩ።',

    'cmd.start': 'ይመዝገቡ፣ የመጫወቻ ቁልፉን ያግኙ',
    'cmd.play': 'የቢንጎ ጨዋታውን ይክፈቱ',
    'cmd.balance': 'የዋሌት ቀሪ ሂሳብ',
    'cmd.deposit': 'ገንዘብ ማስገቢያ መመሪያ',
    'cmd.withdraw': 'ገንዘብ ማውጫ መመሪያ',
    'cmd.rules': 'የጨዋታ ሕግ',
    'cmd.profile': 'ስምዎ እና ስልክዎ',
    'cmd.language': 'አማርኛ / English',
    'cmd.contact': 'ድጋፍ',
    'cmd.help': 'ማድረግ የምችላቸው ሁሉ',
  },
};

export function t(lang, key, vars = {}) {
  const text = STRINGS[LANGS.includes(lang) ? lang : DEFAULT_LANG][key] ?? STRINGS.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));
}

/** Every language's text for `key`: used to recognise a tapped reply-keyboard button whatever the language. */
export const allTexts = (key) => LANGS.map((lang) => STRINGS[lang][key]).filter(Boolean);

/** Key sets per language, for the test that keeps the two dictionaries in step. */
export const keysOf = (lang) => Object.keys(STRINGS[lang]).sort();

/**
 * The bot's public profile, shown by Telegram before a chat starts and on the bot's page
 * (BotFather: /setdescription, /setabouttext). Applied at start-up by index.js. Keep every
 * claim true: no "licensed", no "#1" until it is.
 */
export const BOT_PROFILE = Object.freeze({
  // Bot page and share previews, max 120 characters.
  about: 'USA ቢንጎ 🎱 ቀጥታ ቢንጎ በቴሌግራም · 10፣ 20፣ 50 ብር ጠረጴዛዎች · እስከ 3,000 ብር ሽልማት · በቴሌብር ያስገቡ፣ ያውጡ · 21+',
  // The empty chat, before START, max 512 characters.
  description: [
    '🇺🇸🎱 እንኳን ወደ USA ቢንጎ በደህና መጡ!',
    '',
    'ቴሌግራም ሳይለቁ ከእውነተኛ ተጫዋቾች ጋር ቀጥታ ቢንጎ ይጫወቱ።',
    '',
    '💵 10፣ 20 እና 50 ብር ጠረጴዛዎች',
    '🎟 በአንድ ዙር እስከ 4 ካርቴላ',
    '🏆 በአንድ ዙር እስከ 3,000 ብር ሽልማት',
    '🗣 ቁጥሮች በአማርኛ ይጠራሉ',
    '📲 በቴሌብር ያስገቡ፣ በቴሌብር ያውጡ',
    '',
    'ለመጀመር START ይጫኑ 👇',
    '',
    'Live bingo inside Telegram: 10/20/50 ETB tables, prizes up to 3,000 ETB, Telebirr in and out. 21+ · Play responsibly.',
  ].join('\n'),
});
