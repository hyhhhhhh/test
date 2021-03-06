const http = require("http");
const express = require("express");
const bodyParser = require("body-parser");
const convict = require("convict");
const { Event } = require("./brigade-event")
const passport = require("passport");
const SlackStrategy = require("@aoberoi/passport-slack").default.Strategy;
const { createSlackEventAdapter } = require("@slack/events-api");
const { WebClient } = require('@slack/client');

var config = convict({
    // Example of a custom var. See chart/values.yaml for the definition.
    project: {
        doc: "The Brigade project that this bot is connected to.",
        // Default is deis/empty-testbed
        default: "brigade-830c16d4aaf6f5490937ad719afd8490a5bcbef064d397411043ac",
        env: "GATEWAY_PROJECT"
    },

    // These actually get loaded out of the project.
    slackBotToken: {
        doc: "Bot token from Slack",
        default: "botToken",
        env: "SLACK_BOT_TOKEN",
        sensitive: true,
    },
    slackClientID: {
        doc: "Client ID for authenticating to Slack",
        default: "clientID",
        env: "SLACK_CLIENT_ID"
    },
    slackClientSecret: {
        doc: "Secret for authenticating to Slack",
        default: "clientSecret",
        env: "SLACK_CLIENT_SECRET",
        sensitive: true,
    },
    slackVerificationToken: {
        doc: "Verification token for slack app",
        default: "verificatioNToken",
        env: "SLACK_VERIFICATION_TOKEN",
        sensitive: true,
    },

    // Predefined vars.
    port: {
        doc: "Port number",
        default: 8080,
        format: "port",
        env: "GATEWAY_PORT"
    },
    ip: {
        doc: "The pod IP address assigned by Kubernetes",
        format: "ipaddress",
        default: "127.0.0.1",
        env: "GATEWAY_IP"
    },
    namespace: {
        doc: "The Kubernetes namespace. Usually passed via downward API.",
        default: "default",
        env: "GATEWAY_NAMESPACE"
    },
    appName: {
        doc: "The name of this app, according to Kubernetes",
        default: "unknown",
        env: "GATEWAY_NAME"
    }
});
config.loadFile("/etc/app/config.json")
config.validate({allowed: 'strict'});

const namespace = config.get("namespace");
const project = config.get("project");
const eventName = "app_mention";
const slackEvents = createSlackEventAdapter(config.get("slackVerificationToken"))
const slackClient = new WebClient(config.get("slackBotToken"));

const app = express();
app.use(bodyParser.json());
app.use("/slack/events", slackEvents.expressMiddleware());

slackEvents.on("error", console.error);
slackEvents.on("app_mention", (event) => {
    // TODO: Validate that the team OAuthed.
    let envelope = {
        // It's not totally clear to me if we need this.
        verificationToken: botAuthorizations[event.team_id],
        event: event
    }

    let brigEvent = new Event(namespace);
    brigEvent.event_provider = "slack";
    brigEvent.create(eventName, project, JSON.stringify(envelope)).then(() => {
        console.log(`build ${ brigEvent.build_id }`)
    }).catch((e) => {
        console.error(e);
    });
});

// ==== OAUTH for Slack ====
// Initialize Add to Slack (OAuth) helpers.
let botAuthorizations = {}
passport.use(new SlackStrategy({
    clientID: config.get("slackClientID"),
    clientSecret: config.get("slackClientSecret"),
    skipUserProfile: true,
}, (accessToken, scopes, team, extra, profiles, done) => {
    botAuthorizations[team.id] = extra.bot.accessToken;
    done(null, {});
}));
app.use(passport.initialize());
app.get('/', (req, res) => {
    res.send('<a href="/auth/slack"><img alt="Add to Slack" height="40" width="139" src="https://platform.slack-edge.com/img/add_to_slack.png" srcset="https://platform.slack-edge.com/img/add_to_slack.png 1x, https://platform.slack-edge.com/img/add_to_slack@2x.png 2x" /></a>');
});
app.get('/auth/slack', passport.authenticate('slack', {
    scope: ['bot']
}));
app.get('/auth/slack/callback',
    passport.authenticate('slack', { session: false }),
    (req, res) => {
      console.log("/auth/slack/callback executed");
      res.send('<p>Greet and React was successfully installed on your team.</p>');
    },
    (err, req, res, next) => {
      res.status(500).send(`<p>Greet and React failed to install</p> <pre>${err}</pre>`);
    }
);

// ==== BOILERPLATE ====
// Kubernetes health probe. If you remove this, you will need to modify
// the deployment.yaml in the chart.
app.get("/healthz", (req, res)=> {
    res.send("OK");
})
// Start the server.
http.createServer(app).listen(config.get('port'), () => {
    console.log(`Running on ${config.get("ip")}:${config.get("port")}`)
})