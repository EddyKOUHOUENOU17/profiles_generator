// Bot Telegram pour générer des profils depuis fichiers JSON
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const moment = require('moment');

const bot = new Telegraf('7798388764:AAFdu4kqxcqsyWcyZIy6PxpNpSj0PrFO0jM');

const config = {
  FR: { label: '🇫🇷 France', ages: ['16-24'] },
  DE: { label: '🇩🇪 Allemagne', ages: ['16+', '55+', '18-24'] },
  US: { label: '🇺🇸 USA', ages: ['16+', '35+', 'Hispanic', 'Asian'] },
  ES: { label: '🇪🇸 Espagne', ages: ['18-24'] },
  CA: { label: '🇨🇦 Canada', ages: ['16-24'] },
  IT: { label: '🇮🇹 Italie', ages: ['16+'] },
  IE: { label: '🇮🇪 Irlande', ages: ['18+'] },
  AU: { label: '🇦🇺 Australie', ages: ['16+', '18-24'] },
  CH: { label: '🇨🇭 Suisse', ages: ['16+', '18+'] }
};

const userQuotaFile = './data/users.json';
let userQuota = fs.existsSync(userQuotaFile) ? JSON.parse(fs.readFileSync(userQuotaFile)) : {};

const sessions = {};

function getTodayDate() {
  return moment().format('DD-MM-YYYY');
}

function getUserKey(id) {
  return String(id);
}

function checkQuota(userId) {
  const key = getUserKey(userId);
  const today = getTodayDate();
  if (!userQuota[key]) userQuota[key] = { date: today, count: 0 };
  if (userQuota[key].date !== today) userQuota[key] = { date: today, count: 0 };
  return userQuota[key].count < 10;
}

function incrementQuota(userId) {
  const key = getUserKey(userId);
  userQuota[key].count++;
  fs.writeFileSync(userQuotaFile, JSON.stringify(userQuota, null, 2));
}

function startSession(userId) {
  sessions[userId] = { step: 'pays' };
}

function ageFromBirth(dob) {
  return moment(dob, 'DD/MM/YYYY').isValid() ? moment().diff(moment(dob, 'DD/MM/YYYY'), 'years') : 0;
}

function matchAgeRange(profile, range) {
  const age = ageFromBirth(profile.date_naissance);
  const match = range.match(/(\d+)[^\d]*(\d+)?/);
  if (!match) return true;
  const min = parseInt(match[1], 10);
  const max = match[2] ? parseInt(match[2], 10) : 99;
  return age >= min && age <= max;
}

function getProfileFile(pays) {
  return `./data/${pays}.json`;
}

// --- Commande de démarrage ---
bot.start((ctx) => {
  const id = ctx.from.id;
  startSession(id);
  ctx.reply(
    "👋 Salut l’ami ! Choisis un pays :",
    Markup.inlineKeyboard(
      Object.entries(config).map(([code, info]) =>
        Markup.button.callback(`${info.label}`, `pays_${code}`)
      ),
      { columns: 3 }
    )
  );
});

// --- Sélection Pays ---
bot.action(/pays_(.+)/, (ctx) => {
  const pays = ctx.match[1];
  const id = ctx.from.id;
  if (!config[pays]) return ctx.answerCbQuery('Pays invalide.');
  sessions[id] = { step: 'sexe', pays };

  ctx.editMessageText(
    `🌍 Pays sélectionné : *${config[pays].label}*\nChoisis un sexe :`,
    Markup.inlineKeyboard([
      Markup.button.callback('👨 Homme', 'sexe_H'),
      Markup.button.callback('👩 Femme', 'sexe_F'),
      Markup.button.callback('🔙 Retour', 'retour_pays')
    ], { columns: 2 }),
    { parse_mode: 'Markdown' }
  );
});

// --- Retour pays ---
bot.action('retour_pays', (ctx) => {
  const id = ctx.from.id;
  startSession(id);
  ctx.editMessageText(
    "🌍 Choisis un pays :",
    Markup.inlineKeyboard(
      Object.entries(config).map(([code, info]) =>
        Markup.button.callback(`${info.label}`, `pays_${code}`)
      ),
      { columns: 3 }
    )
  );
});

// --- Sélection Sexe ---
bot.action(/sexe_(.+)/, (ctx) => {
  const sexe = ctx.match[1];
  const id = ctx.from.id;
  if (!sessions[id] || !sessions[id].pays) return ctx.reply("❌ Session expirée. Tape /start.");
  sessions[id].step = 'age';
  sessions[id].sexe = sexe;

  const pays = sessions[id].pays;
  const tranches = config[pays].ages || [];

  ctx.editMessageText(
    `👤 Sexe sélectionné : *${sexe === 'H' ? 'Homme' : 'Femme'}*\nChoisis une tranche d’âge :`,
    Markup.inlineKeyboard(
      [
        ...tranches.map(tr => Markup.button.callback(`⏳ ${tr}`, `age_${Buffer.from(tr).toString('base64')}`)),
        Markup.button.callback('🔙 Retour', 'retour_sexe')
      ],
      { columns: 2 }
    ),
    { parse_mode: 'Markdown' }
  );
});

// --- Retour Sexe ---
bot.action('retour_sexe', (ctx) => {
  const id = ctx.from.id;
  if (!sessions[id]) return ctx.reply("❌ Session expirée. Tape /start.");
  sessions[id].step = 'sexe';
  ctx.editMessageText(
    '👤 Choisis un sexe :',
    Markup.inlineKeyboard([
      Markup.button.callback('👨 Homme', 'sexe_H'),
      Markup.button.callback('👩 Femme', 'sexe_F'),
      Markup.button.callback('🔙 Retour', 'retour_pays')
    ], { columns: 2 })
  );
});

// --- Sélection Tranche d’âge ---
bot.action(/age_(.+)/, async (ctx) => {
  const encoded = ctx.match[1];
  const tranche = Buffer.from(encoded, 'base64').toString('utf-8');
  const id = ctx.from.id;
  const session = sessions[id];
  if (!session || !session.sexe || !session.pays) return ctx.reply("❌ Session expirée. Tape /start.");
  if (!checkQuota(id)) return ctx.reply("⛔️ Tu as déjà généré 10 profils aujourd’hui.");

  const file = getProfileFile(session.pays);
  if (!fs.existsSync(file)) return ctx.reply("⚠️ Aucun fichier de profils pour ce pays.");

  let profils = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const dispo = profils.filter(p => p.sexe === session.sexe && matchAgeRange(p, tranche));

  if (!dispo.length) return ctx.reply("😢 Aucun profil dispo pour ces critères.");

  const profil = dispo[Math.floor(Math.random() * dispo.length)];
  profils = profils.filter(p => p !== profil);
  fs.writeFileSync(file, JSON.stringify(profils, null, 2));

  incrementQuota(id);

  ctx.replyWithMarkdown(
    `✅ *Profil généré :*\n👤 *Nom* : ${profil.prenom} ${profil.nom}\n🎂 *Date de naissance* : ${profil.date_naissance}\n📍 *Ville* : ${profil.ville}\n🏞️ *État* : ${profil.etat}\n🏷️ *Code postal* : ${profil.code_postal}\n👫 *Sexe* : ${profil.sexe === 'H' ? 'Homme' : 'Femme'}`
  );
});

bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
