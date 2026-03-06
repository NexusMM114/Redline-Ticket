require("dotenv").config()

/* ================= IMPORTS ================= */

const {
Client,
GatewayIntentBits,
EmbedBuilder,
ActionRowBuilder,
StringSelectMenuBuilder,
ModalBuilder,
TextInputBuilder,
TextInputStyle,
ButtonBuilder,
ButtonStyle,
ChannelType
} = require("discord.js")

const mongoose = require("mongoose")
const { createTranscript } = require("discord-html-transcripts")

/* ================= DATABASE ================= */

mongoose.connect(process.env.MONGO_URI)
.then(()=>console.log("MongoDB Connected"))
.catch(err=>console.log(err))

const ticketSchema = new mongoose.Schema({
ticketNumber:Number,
userId:String,
channelId:String,
staffId:String
})

const Ticket = mongoose.model("Ticket",ticketSchema)

const counterSchema = new mongoose.Schema({
name:String,
value:Number
})

const Counter = mongoose.model("Counter",counterSchema)

/* ================= CLIENT ================= */

const client = new Client({
intents:[GatewayIntentBits.Guilds]
})

/* ================= READY EVENT ================= */

client.once("ready", async ()=>{

console.log(`${client.user.tag} online`)

const channel = await client.channels.fetch(process.env.PANEL_CHANNEL)

const embed = new EmbedBuilder()
.setColor("Red")
.setTitle("Support Tickets")
.setDescription(`# RedLine - Support Center

Welcome to the **RedLine Ticket System** — your gateway to fast and friendly assistance! Need help, want to appeal a ban, or claim a reward? You’re in the right place.

Please select a category below to open a ticket. Our staff will be with you shortly.

**Available Ticket Types:**
1. <a:dc:1479163975387320422> General Support - Question, bugs , or anything else 
2. <:topgg_ico_info:1479164531816267839> Unban Appeal - Think Your ban was a mistake? let's talk
3. <:Giveaway:1479163928985604207> Purchase Rank & Items - Help with donations or missing perks 
4. <a:verify:1479164474232668200> Claim a Reward - Won an event or earned a gift? Redeem it here 
5. <:staff:1479167441132060702> And More - Other issues? We're happy to help!

**Support Hours:**
Daily — 7:00 AM to 10:00 PM IST

Please be patient while we respond—your satisfaction is our priority.`)

.setImage("https://cdn.discordapp.com/attachments/1393984180924317821/1478467125944254505/standard_1.gif")
.setFooter({ text: "Thanks for being part of the RedLine community!.." })

const menu = new ActionRowBuilder().addComponents(

new StringSelectMenuBuilder()
.setCustomId("ticket_menu")
.setPlaceholder("Select Ticket Type")
.addOptions([
{
label:"General Support",
value:"general",
emoji:"1479163975387320422"
},
{
label:"Unban Appeal",
value:"appeal",
emoji:"1479164531816267839"
},
{
label:"Purchase Rank & Items",
value:"purchase",
emoji:"1318155717923831900"
},
{
label:"Claim Reward",
value:"reward",
emoji:"1479164474232668200"
}
])

)

channel.send({
embeds:[embed],
components:[menu]
})

})

/* ================= INTERACTIONS ================= */

client.on("interactionCreate", async interaction=>{

/* ===== MENU → MODAL ===== */

if(interaction.isStringSelectMenu() && interaction.customId==="ticket_menu"){

const modal = new ModalBuilder()
.setCustomId("ticket_modal")
.setTitle("Create Ticket")

const mc = new TextInputBuilder()
.setCustomId("minecraft")
.setLabel("Minecraft Username")
.setStyle(TextInputStyle.Short)

const desc = new TextInputBuilder()
.setCustomId("description")
.setLabel("Describe your issue")
.setStyle(TextInputStyle.Paragraph)

modal.addComponents(
new ActionRowBuilder().addComponents(mc),
new ActionRowBuilder().addComponents(desc)
)

interaction.showModal(modal)

}

/* ===== CREATE TICKET ===== */

if(interaction.isModalSubmit() && interaction.customId==="ticket_modal"){

let counter = await Counter.findOne({name:"ticket"})

if(!counter){
counter = await Counter.create({name:"ticket",value:1})
}else{
counter.value++
await counter.save()
}

const number = counter.value.toString().padStart(4,"0")

const channel = await interaction.guild.channels.create({

name:`ticket-${number}`,
type:ChannelType.GuildText,
parent:process.env.TICKET_CATEGORY,

permissionOverwrites:[
{ id:interaction.guild.id, deny:["ViewChannel"] },
{ id:interaction.user.id, allow:["ViewChannel","SendMessages"] },
{ id:process.env.SUPPORT_ROLE, allow:["ViewChannel","SendMessages"] }
]

})

await Ticket.create({
ticketNumber:number,
userId:interaction.user.id,
channelId:channel.id
})

const buttons = new ActionRowBuilder().addComponents(

new ButtonBuilder()
.setCustomId("claim")
.setLabel("Claim")
.setStyle(ButtonStyle.Success),

new ButtonBuilder()
.setCustomId("close")
.setLabel("Close")
.setStyle(ButtonStyle.Danger)

)

channel.send({
content:`<@&${process.env.SUPPORT_ROLE}>`,
embeds:[
new EmbedBuilder()
.setColor("Red")
.setTitle("🎫 Ticket Created")
.setDescription(`Hello <@${interaction.user.id}>!

Thank you for contacting **RedLine Support**.`)
.addFields(
{name:"Minecraft Username",value:interaction.fields.getTextInputValue("minecraft")},
{name:"Description",value:interaction.fields.getTextInputValue("description")}
)
],
components:[buttons]
})

interaction.reply({
content:`✅ Ticket created: ${channel}`,
ephemeral:true
})

}

/* ===== CLAIM ===== */

if(interaction.isButton() && interaction.customId==="claim"){

await Ticket.updateOne(
{channelId:interaction.channel.id},
{$set:{staffId:interaction.user.id}}
)

interaction.reply({
content:`🔧 Ticket claimed by <@${interaction.user.id}>`
})

}

/* ===== CLOSE ===== */

if(interaction.isButton() && interaction.customId==="close"){

interaction.reply({
content:`🔒 Closing Ticket...
Generating transcript and requesting feedback.`
})

const ticket = await Ticket.findOne({channelId:interaction.channel.id})

const user = await client.users.fetch(ticket.userId)

const transcript = await createTranscript(interaction.channel,{
limit:-1,
filename:`${interaction.channel.name}.html`
})

const reviewChannel = await client.channels.fetch(process.env.REVIEW_CHANNEL)

reviewChannel.send({
embeds:[
new EmbedBuilder()
.setColor("Red")
.setTitle("Ticket Closed")
.setDescription(`Ticket: ${interaction.channel.name}

User: <@${ticket.userId}>
Staff: <@${interaction.user.id}>`)
],
files:[transcript]
})

const ratingMenu = new ActionRowBuilder().addComponents(
new StringSelectMenuBuilder()
.setCustomId("rating")
.setPlaceholder("Rate Support")
.addOptions([
{label:"1 Star",value:"1"},
{label:"2 Stars",value:"2"},
{label:"3 Stars",value:"3"},
{label:"4 Stars",value:"4"},
{label:"5 Stars",value:"5"}
])
)

user.send({
content:`⭐ RedLine Support

Your ticket has been closed.
Please rate your support experience.`,
components:[ratingMenu]
})

setTimeout(()=>{
interaction.channel.delete()
},10000)

}

/* ===== RATING ===== */

if(interaction.isStringSelectMenu() && interaction.customId==="rating"){

const rating = interaction.values[0]
const stars = "⭐".repeat(rating)

interaction.reply({
content:`Thanks for your feedback!\n${stars}`,
ephemeral:true
})

const reviewChannel = await client.channels.fetch(process.env.REVIEW_CHANNEL)

reviewChannel.send({
embeds:[
new EmbedBuilder()
.setColor("Gold")
.setTitle("Ticket Feedback")
.setDescription(`User: <@${interaction.user.id}>

Rating: ${stars}`)
]
})

}

})

/* ================= LOGIN ================= */

client.login(process.env.TOKEN)
