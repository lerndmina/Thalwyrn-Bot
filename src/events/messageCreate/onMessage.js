const { MessageType, MessageFlags, ActivityType, Message, Client } = require("discord.js");
var log = require("fancy-log");
const onMention = require("../../utils/onMention");
const syncCommands = require("../../utils/unregister-commands");
const TranscribeMessage = require("../../utils/TranscribeMessage");
const BasicEmbed = require("../../utils/BasicEmbed");
const { convertCompilerOptionsFromJson } = require("typescript");

const env = require("../../utils/FetchEnvs")();

const BANNED_GUILDS = ["856937743543304203"];

/**
 *
 * @param {Message} message
 * @param {Client} client
 * @returns
 */
module.exports = async (message, client) => {
  if (BANNED_GUILDS.includes(message.guildId)) return;

  if (message.author.bot) return;

  if (message.content.startsWith(`${env.PREFIX}embedtest`)) {
    if (!env.OWNER_IDS.includes(message.author.id)) return;

    message.reply({
      embeds: [
        BasicEmbed(
          client,
          "Title",
          "Description",
          [
            {
              name: "Fields",
              value: '```js\n[{ name: "Hello", value: "World", inline: true }]```',
              inline: true,
            },
          ],
          "Random"
        ),
      ],
    });
  }

  // Unync commmand
  if (message.content.startsWith(`${env.PREFIX}unsync`)) {
    if (!env.OWNER_IDS.includes(message.author.id)) return;
    if (message.content.includes("global")) {
      syncCommands(client, message, message.guildId, true);
      return true;
    }
    syncCommands(client, message, message.guildId, false);
    return true;
  }

  // Reboot command
  if (message.content.startsWith(`${env.PREFIX}reboot`)) {
    if (!env.OWNER_IDS.includes(message.author.id)) return;
    if (message.content == `${env.PREFIX}reboot hard`) process.exit(0);

    await message.reply({
      embeds: [BasicEmbed(client, "Reboot", "Rebooting...")],
    });
    log("Rebooting...");

    // Set offline
    client.user.setActivity("my own death.", { type: ActivityType.Watching });
    client.user.setStatus("dnd");

    // Cleanly log out of Discord
    client.destroy();

    // Log back in
    const { Start } = require("../../Bot");

    await Start();
  }

  if (message.type == MessageType.Reply) {
    const channel = message.channel;
    const repliedMessage = await channel.messages.fetch(message.reference.messageId);
    if (repliedMessage.author.id != client.user.id) return;

    if (repliedMessage.interaction != null) return;

    onMention(client, message, env.OPENAI_API_KEY);
    return true;
  }
  if (message.content.includes(client.user.id)) {
    onMention(client, message, env.OPENAI_API_KEY);
    return true;
  }

  if (message.flags == MessageFlags.IsVoiceMessage && message.attachments.size == 1) {
    if (message.reactions.cache.size > 0) return;
    message.react("✍️").then(() => message.react("❌"));
  }
};
