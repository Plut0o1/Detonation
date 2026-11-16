
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';

const TOURNAMENT_KEY = (guildId) => `guild:${guildId}:tournament`;

export default {
  category: 'Tournament',

  data: new SlashCommandBuilder()
    .setName('tournament')
    .setDescription('Manage server tournaments')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Create a tournament')
        .addStringOption(option =>
          option.setName('format')
            .setDescription('Choose the team format')
            .setRequired(true)
            .addChoices(
              { name: '1v1', value: '1v1' },
              { name: '2v2', value: '2v2' },
              { name: '3v3', value: '3v3' },
              { name: '4v4', value: '4v4' },
            )
        )
        .addStringOption(option =>
          option.setName('name')
            .setDescription('Tournament name')
            .setRequired(true)
            .setMaxLength(80)
        )
    )

    .addSubcommand(subcommand =>
      subcommand.setName('participants')
        .setDescription('View registered teams and substitutes')
    )

    .addSubcommand(subcommand =>
      subcommand.setName('start')
        .setDescription('Start the tournament')
    )

    .addSubcommand(subcommand =>
      subcommand.setName('end')
        .setDescription('End the current tournament')
    )

    .addSubcommand(subcommand =>
      subcommand
        .setName('substitute')
        .setDescription('Assign a substitute to a player who did not come')
        .addIntegerOption(option =>
          option.setName('team')
            .setDescription('Team number')
            .setRequired(true)
            .setMinValue(1)
        )
        .addUserOption(option =>
          option.setName('missing_player')
            .setDescription('The player who did not come')
            .setRequired(true)
        )
        .addUserOption(option =>
          option.setName('substitute')
            .setDescription('The substitute taking their place')
            .setRequired(true)
        )
    ),

  async execute(interaction, config, client) {
    const subcommand = interaction.options.getSubcommand();
    const key = TOURNAMENT_KEY(interaction.guildId);
    const db = client.db;

    try {
      const tournament = await db.get(key, null);

      if (subcommand === 'create') {
        if (
          tournament?.status === 'registration' ||
          tournament?.status === 'active'
        ) {
          return interaction.reply({
            content: 'There is already an active tournament in this server. End it before creating another.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const format = interaction.options.getString('format', true);
        const name = interaction.options.getString('name', true);

        const newTournament = {
          name,
          format,
          teamSize: Number(format[0]),
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          createdBy: interaction.user.id,
          createdAt: new Date().toISOString(),
          status: 'registration',
          teams: [],
          substitutes: [],
        };

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle(`🏆 ${name}`)
          .setDescription(
            `**Format:** ${format}\n` +
            `**Players per team:** ${newTournament.teamSize}\n` +
            '**Status:** Open for registration\n\n' +
            'Register your team using the button below.\n' +
            'Players who want to be reserves can register as substitutes.'
          )
          .setFooter({ text: 'Tournament Registration' })
          .setTimestamp();

        const buttons = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('tournament_register')
            .setLabel('Register Team')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('tournament_substitute')
            .setLabel('Become a Substitute')
            .setStyle(ButtonStyle.Primary),
        );

        await db.set(key, newTournament);

        await interaction.channel.send({
          embeds: [embed],
          components: [buttons],
        });

        return interaction.reply({
          content: `Tournament **${name}** created! Registration is now open.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (!tournament) {
        return interaction.reply({
          content: 'There is no tournament currently set up in this server.',
          flags: MessageFlags.Ephemeral,
        });
      }

      if (subcommand === 'participants') {
        const teamLines = (tournament.teams || []).map((team, index) => {
          const players = team.players.map(playerId => {
            const replacement = (team.replacements || []).find(
              item => item.originalPlayerId === playerId
            );

            if (replacement) {
              return (
                `• <@${playerId}> — **Didn't come**\n` +
                `  ↳ <@${replacement.substitutePlayerId}> (Substitute)`
              );
            }

            return `• <@${playerId}>`;
          });

          return `**Team ${index + 1}**\n${players.join('\n')}`;
        });

        const substituteLines = (tournament.substitutes || []).map(
          id => `• <@${id}>`
        );

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle(`🏆 ${tournament.name} — Participants`)
          .setDescription(
            `**Format:** ${tournament.format}\n` +
            `**Status:** ${tournament.status}\n\n` +
            `**Teams (${teamLines.length}):**\n` +
            (teamLines.join('\n\n') || 'No teams registered yet.') +
            `\n\n**Available substitutes (${substituteLines.length}):**\n` +
            (substituteLines.join('\n') || 'No substitutes available.')
          );

        return interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (subcommand === 'substitute') {
        if (tournament.status !== 'active') {
          return interaction.reply({
            content: 'You can only assign substitutes after the tournament has started.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const teamNumber = interaction.options.getInteger('team', true);
        const missingPlayer = interaction.options.getUser('missing_player', true);
        const substitute = interaction.options.getUser('substitute', true);

        const team = tournament.teams[teamNumber - 1];

        if (!team) {
          return interaction.reply({
            content: 'That team number does not exist.',
            flags: MessageFlags.Ephemeral,
          });
        }

        if (!team.players.includes(missingPlayer.id)) {
          return interaction.reply({
            content: 'That player is not registered on the selected team.',
            flags: MessageFlags.Ephemeral,
          });
        }

        team.replacements ??= [];

        if (team.replacements.some(
          item => item.originalPlayerId === missingPlayer.id
        )) {
          return interaction.reply({
            content: 'That player already has a substitute assigned.',
            flags: MessageFlags.Ephemeral,
          });
        }

        if (missingPlayer.id === substitute.id) {
          return interaction.reply({
            content: 'A player cannot substitute for themselves.',
            flags: MessageFlags.Ephemeral,
          });
        }

        if (!tournament.substitutes.includes(substitute.id)) {
          return interaction.reply({
            content: 'That user is not registered as an available tournament substitute.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const alreadyAssigned = tournament.teams.some(existingTeam =>
          (existingTeam.replacements || []).some(
            item => item.substitutePlayerId === substitute.id
          )
        );

        if (alreadyAssigned) {
          return interaction.reply({
            content: 'That substitute has already been assigned to another player.',
            flags: MessageFlags.Ephemeral,
          });
        }

        team.replacements.push({
          originalPlayerId: missingPlayer.id,
          substitutePlayerId: substitute.id,
          assignedBy: interaction.user.id,
          assignedAt: new Date().toISOString(),
        });

        tournament.substitutes = tournament.substitutes.filter(
          id => id !== substitute.id
        );

        await db.set(key, tournament);

        return interaction.reply({
          content:
            `Successfully assigned <@${substitute.id}> to Team ${teamNumber}!\n` +
            `<@${missingPlayer.id}> is marked as **Didn't come**.`,
        });
      }

      if (subcommand === 'start') {
        if (tournament.status !== 'registration') {
          return interaction.reply({
            content: 'This tournament is not currently accepting registrations.',
            flags: MessageFlags.Ephemeral,
          });
        }

        tournament.status = 'active';
        tournament.startedAt = new Date().toISOString();

        await db.set(key, tournament);

        return interaction.reply({
          content: `🏆 **${tournament.name}** has started!`,
        });
      }

      if (subcommand === 'end') {
        tournament.status = 'ended';
        tournament.endedAt = new Date().toISOString();

        await db.set(key, tournament);

        return interaction.reply({
          content: `The tournament **${tournament.name}** has ended.`,
        });
      }
    } catch (error) {
      console.error('Tournament command error:', error);

      const response = {
        content: 'Something went wrong while managing the tournament.',
        flags: MessageFlags.Ephemeral,
      };

      if (interaction.replied || interaction.deferred) {
        return interaction.followUp(response);
      }

      return interaction.reply(response);
    }
  },
};
