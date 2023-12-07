const {
  MessageType,
  MessageFlags,
  ActivityType,
  Message,
  Client,
  User,
  ButtonInteraction,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  StringSelectMenuInteraction,
  ThreadAutoArchiveDuration,
  ThreadChannel,
} = require("discord.js");
const { ButtonBuilder, ButtonStyle, SlashCommandBuilder } = require("discord.js");
var log = require("fancy-log");
const BasicEmbed = require("../../utils/BasicEmbed");
const Modmail = require("../../models/Modmail");
const ModmailConfig = require("../../models/ModmailConfig");
const ButtonWrapper = require("../../utils/ButtonWrapper");
const { waitingEmoji } = require("../../Bot");
const postWebhookToThread = require("../../utils/TinyUtils");
const MAX_TITLE_LENGTH = 50;

module.exports = async (message, client) => {
  if (message.author.bot) return;
  const user = message.author;

  if (message.guildId) {
    if (message.channel instanceof ThreadChannel) {
      await handleReply(message, client, user);
    }
  } else {
    await handleDM(message, client, user);
  }
};

/**
 * @param {Message} message
 * @param {Client} client
 * @param {User} user
 */
async function handleDM(message, client, user) {
  const requestId = message.id;
  const mail = await Modmail.findOne({ userId: user.id });
  const customIds = [`create-${requestId}`, `cancel-${requestId}`];
  if (!mail) {
    await newModmail(customIds, message, user, client);
  } else {
    await sendMessage(mail, message, client);
  }
}

/**
 * @param {String[]} customIds
 * @param {Message} message
 * @param {User} user
 * @param {Client} client
 */
async function newModmail(customIds, message, user, client) {
  const buttons = [
    new ButtonBuilder()
      .setCustomId(customIds[0])
      .setLabel("Create Modmail")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(customIds[1]).setLabel("Cancel").setStyle(ButtonStyle.Danger),
  ];

  const reply = await message.reply({
    content: "Would you like to open a modmail thread?",
    components: ButtonWrapper(buttons),
  });

  /**
   * @param {ButtonInteraction} i
   */
  const buttonFilter = (i) => customIds.includes(i.customId);
  const collector = reply.createMessageComponentCollector({ filter: buttonFilter, time: 60000 });

  /**
   * @param {ButtonInteraction} i
   */
  collector.on("collect", async (i) => {
    const orignalMsg = await i.update({ content: waitingEmoji, components: [] });

    if (i.customId === customIds[1]) {
      // Cancel button
      await orignalMsg.delete();
      return;
    }

    // Create button
    // TODO: Look up which servers the user and bot are in that both have modmail enabled
    const sharedGuilds = client.guilds.cache.filter((guild) => guild.members.cache.has(user.id));
    const stringSelectMenuID = `guildList-${i.id}`;
    var guildList = new StringSelectMenuBuilder()
      .setCustomId(stringSelectMenuID)
      .setPlaceholder("Select a server")
      .setMinValues(1)
      .setMaxValues(1);
    var addedSomething = false;

    for (var [_, guild] of sharedGuilds) {
      const config = await ModmailConfig.findOne({ guildId: guild.id });
      if (config) {
        addedSomething = true;
        guildList.addOptions({
          label: guild.name,
          value: JSON.stringify({
            guild: config.guildId,
            channel: config.forumChannelId,
            staffRoleId: config.staffRoleId,
          }),
        });
      }
    }

    if (!addedSomething) {
      await orignalMsg.edit({
        content: "No servers you are in have modmail enabled.",
        components: [],
      });
      return;
    }
    const row = new ActionRowBuilder().addComponents(guildList);
    await orignalMsg.edit({ content: "Please select a server to mail to", components: [row] });

    await serverSelectedOpenModmailThread(orignalMsg, stringSelectMenuID, message);
    return;
  });

  /**
   *
   * @param {ButtonInteraction} reply
   */
  async function serverSelectedOpenModmailThread(reply, stringSelectMenuID, message) {
    const selectMenuFilter = (i) => i.customId === stringSelectMenuID;
    const collector = reply.createMessageComponentCollector({
      filter: selectMenuFilter,
      time: 60000,
    });

    /**
     * @param {StringSelectMenuInteraction} stringSelectInteraction
     */
    collector.on("collect", async (i) => {
      const value = JSON.parse(i.values[0]);
      const guildId = value.guild;
      const channelId = value.channel;
      const staffRoleId = value.staffRoleId;
      await reply.edit({ content: waitingEmoji, components: [] });

      const guild = client.guilds.cache.get(guildId);
      const member = guild.members.cache.get(i.user.id);
      const memberName = member.nickname || member.user.displayName;

      const channel = client.channels.cache.get(channelId);
      const threads = channel.threads;
      const thread = await threads.create({
        name: `${
          message.content.length >= MAX_TITLE_LENGTH
            ? `${message.content.slice(0, MAX_TITLE_LENGTH)}...`
            : message.content
        } - ${memberName}`,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        message: {
          content: `Modmail thread for ${memberName} | ${i.user.id}\n\n Original message: ${
            message.content
          }${member.pending ? "\n\nUser has not fully joined the guild." : ""}`,
        },
      });

      const webhook = await channel.createWebhook({
        name: memberName,
        avatar: i.user.displayAvatarURL(),
        reason: "Modmail Webhook, required to show the user properly.",
      });

      thread.send(`Hey! \`<@&${staffRoleId}>\`, ${memberName} has opened a modmail thread!`);

      await Modmail.findOneAndUpdate(
        { userId: i.user.id },
        {
          guildId: guildId,
          forumThreadId: thread.id,
          userId: i.user.id,
          webhookId: webhook.id,
          webhookToken: webhook.token,
        },
        {
          upsert: true,
          new: true,
        }
      );

      reply.edit({ content: `Modmail is open, staff will reply below.` });
    });
  }
}

/**
 * @param {Modmail} mail
 * @param {Message} message
 * @param {Client} client
 */
async function sendMessage(mail, message, client) {
  try {
    const guild = client.guilds.cache.get(mail.guildId);
    const thread = guild.channels.cache.get(mail.forumThreadId);
    const webhook = await client.fetchWebhook(mail.webhookId, mail.webhookToken);
    if (!(await postWebhookToThread(webhook.url, thread.id, message.content))) {
      thread.send(`${message.author.username} says: ${message.content}`);
      log.error("Failed to send message to thread, sending normally.");
    }
  } catch (error) {
    log.error(error);
    return message.react("<:error:1182430951897321472>");
  }
  return message.react("📨");
}

async function handleReply(message, client, staffUser) {
  const thread = message.channel;
  const mail = await Modmail.findOne({ forumThreadId: thread.id });
  if (!mail) {
    return;
  }

  const user = client.users.cache.get(mail.userId);
  await user.send({ content: message.content });
}