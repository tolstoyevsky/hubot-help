'use strict'

// Description:
//   Generates help commands for Hubot.
//
// Commands:
//   hubot help - Displays all of the help commands that this bot knows about.
//   hubot help <query> - Displays all help commands that match <query>.
//
// URLS:
//   /hubot/help
//
// Configuration:
//   HUBOT_HELP_REPLY_IN_PRIVATE - if set to any value, all `hubot help` replies are sent in private
//   HUBOT_HELP_DISABLE_HTTP - if set, no web entry point will be declared
//   HUBOT_HELP_HIDDEN_COMMANDS - comma-separated list of commands that will not be displayed in help
//
// Notes:
//   These commands are grabbed from comment blocks at the top of each file.

const helpContents = (name, commands) => `\
<!DOCTYPE html>
<html>
  <head>
  <meta charset="utf-8">
  <title>${name} Help</title>
  <style type="text/css">
    body {
      background: #d3d6d9;
      color: #636c75;
      text-shadow: 0 1px 1px rgba(255, 255, 255, .5);
      font-family: Helvetica, Arial, sans-serif;
    }
    h1 {
      margin: 8px 0;
      padding: 0;
    }
    .commands {
      font-size: 13px;
    }
    p {
      border-bottom: 1px solid #eee;
      margin: 6px 0 0 0;
      padding-bottom: 5px;
    }
    p:last-child {
      border: 0;
    }
  </style>
  </head>
  <body>
    <h1>${name} Help</h1>
    <div class="commands">
      ${commands}
    </div>
  </body>
</html>\
`
const routines = require('hubot-routines')

let groupCommand

module.exports = (robot) => {
  robot.respond(/help(?:\s+(.*))?$/i, async (msg) => {
    let cmds = getHelpCommands(robot, msg.message.user.name)
    const filter = msg.match[1]

    if (filter) {
      cmds = cmds.filter(cmd => cmd.match(new RegExp(filter, 'i')))
      if (cmds.length === 0) {
        msg.send(`No available commands match ${filter}`)
        return
      }
    }

    const emit = cmds.join('\n')

    if (process.env.HUBOT_HELP_REPLY_IN_PRIVATE && msg.message && msg.message.user && msg.message.user.name && msg.message.user.name !== msg.message.room) {
      msg.reply('I just replied to you in private.')
      return msg.sendPrivate(emit)
    } else {
      groupCommand = groupByMarkerGroupName(robot, cmds, 'group')
      groupCommand = await filterStatus(robot, groupCommand, msg.message.user.name)
      return msg.send(makeRichMessage(groupCommand))
    }
  })

  robot.listen(msg => {
    if (msg.room === 'general') return false
    const regExps = robot.listeners.map(item => {
      if (item.regex && item.regex.source) {
        return item.regex
      }
    }).filter(item => item)
    for (const reg of regExps) {
      const match = msg.text.match(reg)
      if (match && match[0]) {
        return false
      }
    }

    return true
  }, {}, async msg => {
    const message = msg.message.text.replace('rocketbot ', '')
    const robotName = robot.alias || robot.name
    const ingnorWords = new RegExp(`${robotName} |\\s<.*>|\\s@.*|\\*`, 'g')
    const isAdmin = await routines.isAdmin(robot, msg.message.user.name)

    const filteredCommands = []
    let beginAdmin = false
    for (const c of getHelpCommands(robot)) {
      if (c === 'begin admin') {
        beginAdmin = true
      }

      if ((!isAdmin && !beginAdmin) || isAdmin) {
        filteredCommands.push(c)
      }

      if (c === 'end admin') {
        beginAdmin = false
      }
    }

    let commands = filteredCommands
        .filter(command => !command.match(/^begin|^end/i))
        .map(command => command.slice(0, command.indexOf('-') - 1))
        .filter(command => spellCheckers(message, command.replace(ingnorWords, '')))

    if (commands.length) {
      msg.send(`Может ты имел ввиду:\n${commands.map(command => `${command}`).join('\n')}`)
    } else {
      msg.send('Я не знаю такой команды')
    }
  })

  if (process.env.HUBOT_HELP_DISABLE_HTTP == null) {
    return robot.router.get(`/${robot.name}/help`, (req, res) => {
      let msg
      let cmds = getHelpCommands(robot, msg.message.user.name).map(cmd => cmd.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))

      if (req.query.q != null) {
        cmds = cmds.filter(cmd => cmd.match(new RegExp(req.query.q, 'i')))
      }

      let emit = `<p>${cmds.join('</p><p>')}</p>`

      emit = emit.replace(new RegExp(`${robot.name}`, 'ig'), `<b>${robot.name}</b>`)

      res.setHeader('content-type', 'text/html')
      res.end(helpContents(robot.name, emit))
    })
  }
}
var stringFormatting = function stringFormatting (str) {
  if (!str.match(/^(begin|end)/i)) {
    str = '**' + str
    str = str.replace(/ - /i, '** - ')
  }
  return str
}

/**
 * Parse the array with commands and write groups names and relevant commands to the object.
 *
 * @param {Robot} robot - Hubot instance.
 * @param {array} commands - Array of commands.
 * @param {string} markerName - The name of the marker that mark a start of commands group.
 *
 * @returns {object}
 */
var groupByMarkerGroupName = function groupByMarkerGroupName (robot, commands, markerName) {
  let commandsObject = {}
  let errStatus
  let groupName
  let inMarkerGroup = false
  let inOpeningMarker = false
  let marker
  let markerFullName
  let markerGroupName
  let markerMatch
  let markerReg = new RegExp(`(begin|end)\\s*(${markerName})\\s*(.*)`, 'i')
  let markerRole

  let pushInGroup = (command, markerGroupName) => {
    if (!commandsObject[markerGroupName]) {
      commandsObject[markerGroupName] = []
    }
    commandsObject[markerGroupName].push(command)
  }
  commands.map((command, index) => {
    markerMatch = command.match(markerReg)
    if (markerMatch) {
      marker = markerMatch[1]
      markerRole = markerMatch[2]
      groupName = markerMatch[3]
      markerFullName = markerMatch[0]
      if ((inMarkerGroup && (marker + markerRole) === 'begingroup')) {
        errStatus = `closing`
      }
      if (!inOpeningMarker && markerFullName === `end ${markerName}`) {
        markerGroupName = !inOpeningMarker ? false : markerGroupName
        errStatus = `opening`
      }

      inOpeningMarker = marker === 'begin'
      inMarkerGroup = inOpeningMarker && markerRole === markerName
      markerGroupName = (inMarkerGroup && markerFullName) ? groupName : markerGroupName
    } else {
      if (inMarkerGroup) {
        if (commands.length === index + 1) {
          errStatus = `closing`
        }
        pushInGroup(command, markerGroupName)
      } else {
        pushInGroup(command, 'Other commands')
      }
    }
    if (errStatus) {
      throw (routines.rave(robot, `${markerGroupName ? `In the script "${markerGroupName}" ` : `In some script`} the ${errStatus} marker was not found.`))
    }
  })
  return commandsObject
}

/**
 * Filter the commands by availability to requested user.
 *
 * @param {Robot} robot - Hubot instance.
 * @param {object} groups  - Object of commands which are spited by script name and by group to be filtered.
 * @param {string} userName - Username of user who requested the help message.
 *
 * @returns {object}
 */
var filterStatus = async function filterStatus (robot, groups, userName) {
  let isAdmin = await routines.isAdmin(robot, userName)

  for (let group in groups) {
    let commands = groups[group]
    let sortForStatus = groupByMarkerGroupName(robot, commands, 'admin')
    let groupAdmin = (isAdmin && ('' in sortForStatus)) ? ['\nAdmin only:'].concat(sortForStatus['']) : []
    groups[group] = [...sortForStatus['Other commands'], ...groupAdmin]
  }
  return groups
}

/**
 * Construct the array of rich messages.
 *
 * @param {object} groupCommand - Object with commands divided into groups by keys.
 *
 * @returns {object}
 */
var makeRichMessage = function makeRichMessage (groupCommand) {
  let result = []
  let makeRichMessage = (group) => {
    let commandText
    commandText = groupCommand[group]

    result.push({
      color: '#459d87',
      title: group,
      text: commandText.join('\n'),
      collapsed: true
    })
  }
  for (let group in groupCommand) {
    if (group !== 'Other commands') {
      makeRichMessage(group)
    }
  }
  if (groupCommand['Other commands']) {
    makeRichMessage('Other commands')
  }
  return {attachments: result}
}

var getHelpCommands = function getHelpCommands (robot) {
  let helpCommands = robot.commands

  const robotName = robot.alias || robot.name

  if (hiddenCommandsPattern()) {
    helpCommands = helpCommands.filter(command => !hiddenCommandsPattern().test(command))
  }

  helpCommands = helpCommands.map((command) => {
    if (robotName.length === 1) {
      command = command.replace(/^hubot\s*/i, robotName)
      return stringFormatting(command)
    }

    command = command.replace(/^hubot/i, robotName)
    return stringFormatting(command)
  })

  return helpCommands
}

var hiddenCommandsPattern = function hiddenCommandsPattern () {
  const hiddenCommands = process.env.HUBOT_HELP_HIDDEN_COMMANDS != null ? process.env.HUBOT_HELP_HIDDEN_COMMANDS.split(',') : undefined
  if (hiddenCommands) {
    return new RegExp(`^hubot (?:${hiddenCommands != null ? hiddenCommands.join('|') : undefined}) - `)
  }
}

/**
 * Сhecks for typos by comparing two strings.
 *
 * @param {string} checked - The string that is checked for typos.
 * @param {string} correct - String that assumes the correct word without a typo.
 *
 * @returns {boolean}
 */
var spellCheckers = function spellCheckers (checked, correct) {
  let characterShift = []
  let check
  let checkedWord = checked.toLowerCase().split('')
  let correctWord = correct.toLowerCase().split('')
  let expectedWord
  let intersections = []
  let lengthWord = correct.length
  let pass
  if ((checked.length - correct.length) > 4) return false
  if (correctWord.length - checkedWord.length > 3) return false
  for (let i = 0; i <= lengthWord - 1; i++) {
    if (pass === checkedWord[i]) {
      for (let j = -1; j >= -2; j--) {
        if (correctWord[i] === checkedWord[i + j]) intersections.push(j)
      }
    }
    if (intersections.length - 1 === i) continue
    for (let j = -1 * (intersections[i - 1] === null || intersections[i - 1] === -1); j <= 2; j++) {
      if (correctWord[i] === checkedWord[i + j] && i + j <= lengthWord - 1) {
        intersections.push(j)
        if (j > 0) pass = checkedWord[i + j]
        break
      }
    }
    if (intersections.length - 1 < i) {
      intersections.push(null)
      if (intersections[i - 1] !== null && intersections[i - 2] !== null) {
        characterShift.push(correctWord[i])
      }
    }
  }
  intersections.push('', '', '')
  intersections = intersections.map((iteam, index) => iteam === null ? null : iteam + index)

  expectedWord = intersections.map(word => {
    if (word !== null) {
      return checkedWord[word]
    } else if (characterShift.length) {
      return characterShift.shift()
    }
  }).join('')
  if (expectedWord.length <= 2) return false
  check = new RegExp(expectedWord.slice(0, correct.length), 'i')

  return !!correct.match(check)
}
