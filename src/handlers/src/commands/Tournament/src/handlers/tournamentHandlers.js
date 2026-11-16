
import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} from 'discord.js';

const TOURNAMENT_KEY = (guildId) => `guild:${guildId}:tournament`;

function getPlayerIds(text) {
  return [...new Set(
    text.match(/\d{17,20}/g) || []
  )];
}

function findRegisteredPlayer(tournament, playerId) {
  return tournament.teams.some(team =>
    team.players.includes(playerId)
  );
}

export const tournamentRegisterButton = {
  name: 'tournament_register',

  async execute(interaction, client) {
    const key = TOURNAMENT_KEY(interaction.guildId);
    const tournament = await client.db.get(key, null);

    if (!tournament || tournament.status !== 'registration') {
      return interaction.reply({
        content: 'There is no tournament currently accepting registrations.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId('tournament_team_modal')
      .setTitle('Register Your Team');

    const playersInput = new TextInputBuilder()
      .setCustomId('players')
      .setLabel(`Mention all ${tournament.teamSize} team members`)
      .setPlaceholder('Example: @Player1 @Player2')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1000);

    modal.addComponents(
      new ActionRowBuilder().addComponents(playersInput)
    );

    return interaction.showModal(modal);
  },
};

export const tournamentSubstituteButton = {
  name: 'tournament_substitute',

  async execute(interaction, client) {
    const key = TOURNAMENT_KEY(interaction.guildId);
    const tournament = await client.db.get(key, null);

    if (!tournament || tournament.status !== 'registration') {
      return interaction.reply({
        content: 'There is no tournament currently accepting registrations.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const userId = interaction.user.id;

    if (findRegisteredPlayer(tournament, userId)) {
      return interaction.reply({
        content: 'You are already registered on a team.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (tournament.substitutes.includes(userId)) {
      return interaction.reply({
        content: 'You are already registered as a substitute.',
        flags: MessageFlags.Ephemeral,
      });
    }

    tournament.substitutes.push(userId);
    await client.db.set(key, tournament);

    return interaction.reply({
      content: 'You have successfully registered as a tournament substitute!',
      flags: MessageFlags.Ephemeral,
    });
  },
};

export const tournamentTeamModal = {
  name: 'tournament_team_modal',

  async execute(interaction, client) {
    const key = TOURNAMENT_KEY(interaction.guildId);
    const tournament = await client.db.get(key, null);

    if (!tournament || tournament.status !== 'registration') {
      return interaction.reply({
        content: 'Tournament registration is closed.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const text = interaction.fields.getTextInputValue('players');
    const playerIds = getPlayerIds(text);

    if (playerIds.length !== tournament.teamSize) {
      return interaction.reply({
        content: `You must enter exactly ${tournament.teamSize} different player mentions.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const guild = interaction.guild;

    for (const playerId of playerIds) {
      const member = await guild.members.fetch(playerId).catch(() => null);

      if (!member) {
        return interaction.reply({
          content: `I couldn't find <@${playerId}> in this server.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (findRegisteredPlayer(tournament, playerId)) {
        return interaction.reply({
          content: `<@${playerId}> is already registered on another team.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (tournament.substitutes.includes(playerId)) {
        return interaction.reply({
          content: `<@${playerId}> is already registered as a substitute.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    if (tournament.teams.some(team =>
      team.players.some(id => playerIds.includes(id))
    )) {
      return interaction.reply({
        content: 'One or more players are already registered.',
        flags: MessageFlags.Ephemeral,
      });
    }

    tournament.teams.push({
      players: playerIds,
      registeredBy: interaction.user.id,
      registeredAt: new Date().toISOString(),
    });

    await client.db.set(key, tournament);

    return interaction.reply({
      content: `Your team has successfully registered for **${tournament.name}**!`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
