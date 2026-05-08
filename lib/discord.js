const axios = require("axios");

const DISCORD_API = "https://discord.com/api/v10";
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const ROLE_ID = process.env.DISCORD_ROLE_ID;
const INACTIVE_ROLE_ID = process.env.DISCORD_INACTIVE_ROLE_ID;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;

const bot = axios.create({
  baseURL: DISCORD_API,
  headers: { Authorization: `Bot ${BOT_TOKEN}` },
});

// Exchange OAuth code for access token
async function exchangeCode(code) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
  });
  const { data } = await axios.post(`${DISCORD_API}/oauth2/token`, params, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return data; // { access_token, token_type, expires_in, refresh_token, scope }
}

// Get Discord user info from access token
async function getUserInfo(accessToken) {
  const { data } = await axios.get(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data; // { id, username, discriminator, avatar, ... }
}

// Add user to guild (server) with a role and nickname
async function addToGuild(accessToken, userId, nickname) {
  try {
    const body = {
      access_token: accessToken,
      roles: [ROLE_ID],
    };
    if (nickname) body.nick = nickname;
    await bot.put(`/guilds/${GUILD_ID}/members/${userId}`, body);
    console.log(`[DISCORD] User ${userId} added to guild with role${nickname ? ` (nick: ${nickname})` : ''}`);
    return true;
  } catch (err) {
    // 204 = already in guild, need to add role and nick separately
    if (err.response?.status === 204 || err.response?.status === 409) {
      await addRole(userId, ROLE_ID);
      if (nickname) await setNickname(userId, nickname);
      return true;
    }
    console.error(`[DISCORD ERROR] addToGuild:`, err.response?.data || err.message);
    return false;
  }
}

// Add role to user
async function addRole(userId, roleId) {
  try {
    await bot.put(`/guilds/${GUILD_ID}/members/${userId}/roles/${roleId}`);
    console.log(`[DISCORD] Role ${roleId} added to user ${userId}`);
  } catch (err) {
    console.error(`[DISCORD ERROR] addRole:`, err.response?.data || err.message);
  }
}

// Set nickname for user in guild
async function setNickname(userId, nickname) {
  try {
    await bot.patch(`/guilds/${GUILD_ID}/members/${userId}`, { nick: nickname });
    console.log(`[DISCORD] Nickname set for ${userId}: ${nickname}`);
  } catch (err) {
    console.error(`[DISCORD ERROR] setNickname:`, err.response?.data || err.message);
  }
}

// Check if user is in guild
async function getMember(userId) {
  try {
    const { data } = await bot.get(`/guilds/${GUILD_ID}/members/${userId}`);
    return data;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

// Remove role from user
async function removeRole(userId, roleId) {
  try {
    await bot.delete(`/guilds/${GUILD_ID}/members/${userId}/roles/${roleId}`);
    console.log(`[DISCORD] Role ${roleId} removed from user ${userId}`);
  } catch (err) {
    console.error(`[DISCORD ERROR] removeRole:`, err.response?.data || err.message);
  }
}

// Deactivate user: remove Principiante, add Inactivo
async function deactivateUser(userId) {
  await removeRole(userId, ROLE_ID);
  if (INACTIVE_ROLE_ID) await addRole(userId, INACTIVE_ROLE_ID);
  console.log(`[DISCORD] User ${userId} deactivated`);
}

// Get OAuth URL
function getOAuthURL(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "identify guilds.join",
    state,
  });
  return `${DISCORD_API}/oauth2/authorize?${params}`;
}

module.exports = { exchangeCode, getUserInfo, addToGuild, addRole, removeRole, setNickname, getMember, deactivateUser, getOAuthURL };
