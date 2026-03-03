require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField,
  REST,
  Routes
} = require("discord.js");

const mongoose = require("mongoose");
const transcripts = require("discord-html-transcripts");

// ================= MONGODB =================

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ MongoDB Error:", err));

// ================= SCHEMA =================

const ticketSchema = new mongoose.Schema({
  guildId: String,
  channelId: String,
  userId: String,
  category: String,
  claimedBy: String,
  rating: { type: Number, default: null },
  status: { type: String, default: "open" },
  createdAt: { type: Date, default: Date.now }
});

const Ticket = mongoose.model("Ticket", ticketSchema);

// ================= CLIENT =================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

// ================= READY EVENT =================

client.once("ready", async () => {
  console.log(`${client.user.tag} is online`);

  const commands = [
    { name: "panel", description: "Send the RedLine ticket panel" }
  ];

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(
      client.user.id,
      process.env.GUILD_ID
    ),
    { body: commands }
  );

  console.log("✅ Slash command registered");
});

// ================= INTERACTIONS =================

client.on("interactionCreate", async interaction => {

  // ================= PANEL =================
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "panel") {

      if (!interaction.member.permissions.has("Administrator")) {
        return interaction.reply({
          content: "❌ Only Administrators can use this.",
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setColor("Red")
        .setTitle("RedLine - Support Center")
        .setDescription("Select a category below to open a ticket.");

      const menu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("ticket_select")
          .setPlaceholder("Choose ticket type")
          .addOptions([
            { label: "General Support", value: "general" },
            { label: "Unban Appeal", value: "ban" },
            { label: "Purchase Help", value: "purchase" },
            { label: "Claim Reward", value: "reward" }
          ])
      );

      await interaction.reply({ embeds: [embed], components: [menu] });
    }
  }

  // ================= CREATE TICKET =================
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "ticket_select") {

      await interaction.deferReply({ ephemeral: true });

      const existing = await Ticket.findOne({
        guildId: interaction.guild.id,
        userId: interaction.user.id,
        status: "open"
      });

      if (existing)
        return interaction.editReply("❌ You already have an open ticket.");

      const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        parent: process.env.CATEGORY_ID,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          { id: process.env.STAFF_ROLE, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
      });

      await Ticket.create({
        guildId: interaction.guild.id,
        channelId: channel.id,
        userId: interaction.user.id,
        category: interaction.values[0]
      });

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("claim")
          .setLabel("Claim")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("close")
          .setLabel("Close")
          .setStyle(ButtonStyle.Danger)
      );

      await channel.send({
        content: `<@&${process.env.STAFF_ROLE}> | <@${interaction.user.id}>`,
        components: [buttons]
      });

      await interaction.editReply(`✅ Ticket created: ${channel}`);
    }
  }

  // ================= CLAIM =================
  if (interaction.isButton() && interaction.customId === "claim") {

    if (!interaction.member.roles.cache.has(process.env.STAFF_ROLE)) {
      return interaction.reply({ content: "❌ Staff only.", ephemeral: true });
    }

    const ticket = await Ticket.findOne({ channelId: interaction.channel.id });

    if (!ticket || ticket.claimedBy)
      return interaction.reply({ content: "❌ Already claimed.", ephemeral: true });

    ticket.claimedBy = interaction.user.id;
    await ticket.save();

    await interaction.reply(`✅ Claimed by <@${interaction.user.id}>`);
  }

  // ================= CLOSE + TRANSCRIPT =================
  if (interaction.isButton() && interaction.customId === "close") {

    const ticket = await Ticket.findOne({ channelId: interaction.channel.id });
    if (!ticket) return;

    if (ticket.claimedBy !== interaction.user.id)
      return interaction.reply({ content: "❌ Only claimed staff can close.", ephemeral: true });

    await interaction.reply("📁 Generating transcript & closing...");

    const attachment = await transcripts.createTranscript(interaction.channel);

    const reviewChannel = interaction.guild.channels.cache.get(process.env.REVIEW_CHANNEL);

    await reviewChannel.send({
      content: `📁 Ticket Closed\nUser: <@${ticket.userId}>\nHandled By: <@${ticket.claimedBy}>`,
      files: [attachment]
    });

    const user = await client.users.fetch(ticket.userId);
    await user.send("Please rate your support from 1 to 5 (reply with number).").catch(() => {});

    ticket.status = "closed";
    await ticket.save();

    setTimeout(() => interaction.channel.delete().catch(() => {}), 4000);
  }
});

// ================= REVIEW SYSTEM =================

client.on("messageCreate", async message => {

  if (!message.channel.isDMBased()) return;
  if (isNaN(message.content)) return;

  const rating = Number(message.content);
  if (rating < 1 || rating > 5) return;

  const ticket = await Ticket.findOne({
    userId: message.author.id,
    status: "closed",
    rating: null
  }).sort({ createdAt: -1 });

  if (!ticket) return;

  ticket.rating = rating;
  await ticket.save();

  const reviewChannel = client.channels.cache.get(process.env.REVIEW_CHANNEL);

  await reviewChannel.send(
    `⭐ New Review\nUser: <@${ticket.userId}>\nStaff: <@${ticket.claimedBy}>\nRating: ${rating}/5`
  );

  message.reply("✅ Thank you for your feedback!");
});

// ================= LOGIN =================

client.login(process.env.TOKEN);
