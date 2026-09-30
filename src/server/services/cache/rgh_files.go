package cache

import (
	"net/url"
	"strings"
)

// NormalizeHuggingFaceDownloadURL redirects known Archive.org ZTM links to direct HuggingFace CDN endpoints
// when the file is available in the luistiagos/rgh repository.
func NormalizeHuggingFaceDownloadURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return raw
	}
	if strings.HasPrefix(raw, "https://huggingface.co/") || strings.HasPrefix(raw, "http://huggingface.co/") {
		return raw
	}
	lower := strings.ToLower(raw)
	if strings.Contains(lower, "archive.org/download/") {
		parts := strings.Split(raw, "/")
		if len(parts) > 0 {
			filename := parts[len(parts)-1]
			if unescaped, err := url.PathUnescape(filename); err == nil && unescaped != "" {
				if _, ok := knownRGHFiles[unescaped]; ok {
					return "https://huggingface.co/datasets/luistiagos/rgh/resolve/main/" + url.PathEscape(unescaped)
				}
			}
			if _, ok := knownRGHFiles[filename]; ok {
				return "https://huggingface.co/datasets/luistiagos/rgh/resolve/main/" + url.PathEscape(filename)
			}
		}
	}
	return raw
}

// knownRGHFiles lists releases hosted directly in the luistiagos/rgh HuggingFace dataset.
var knownRGHFiles = map[string]struct{}{
	"CSI.Deadly.Intent.USA.X360-ZTM.rar": {},
	"CSI.Fatal.Conspiracy.USA.X360-ZTM.rar": {},
	"CSI.Hard.Evidence.USA.X360-ZTM.rar": {},
	"College.Hoops.2K8.USA.X360-ZTM.rar": {},
	"Combat.Wings.The.Great.Battles.of.WW2.USA.X360-ZTM.rar": {},
	"Command.&.Conquer.3.Kanes.Wrath.EUR.X360-ZTM.rar": {},
	"Command.&.Conquer.3.Tiberium.Wars.EUR.X360-ZTM.rar": {},
	"Command.&.Conquer.Red.Alert.3.EUR.X360-ZTM.rar": {},
	"Conan.EUR.X360-ZTM.rar": {},
	"Conan.GER.X360-ZTM.rar": {},
	"Conan.JAP.X360-ZTM.rar": {},
	"Condemned.1.Criminal.Origins.EUR.X360-ZTM.rar": {},
	"Condemned.2.Bloodshot.EUR.X360-ZTM.rar": {},
	"Conflict.Denied.Ops.EUR.X360-ZTM.rar": {},
	"Conflict.Denied.Ops.GER.X360-ZTM.rar": {},
	"Conflict.Denied.Ops.JAP.X360-ZTM.rar": {},
	"Convenience.Store.200X.JAP.X360-ZTM.rar": {},
	"Crackdown.1.EUR.X360-ZTM.rar": {},
	"Crackdown.2.EUR.X360-ZTM.rar": {},
	"Crash.Mind.Over.Mutant.USA.X360-ZTM.rar": {},
	"Crash.Time.1.Autobahn.Pursuit.EUR.X360-ZTM.rar": {},
	"Crash.Time.1.Autobahn.Pursuit.USA.X360-ZTM.rar": {},
	"Crash.Time.2.Autobahn.Polizei.EUR.X360-ZTM.rar": {},
	"Crash.Time.2.Autobahn.Polizei.USA.X360-ZTM.rar": {},
	"Crash.Time.3.Highway.Nights.EUR.X360-ZTM.rar": {},
	"Crash.Time.4.The.Syndicate.EUR.X360-ZTM.rar": {},
	"Crash.Time.5.Undercover.EUR.X360-ZTM.rar": {},
	"Crash.of.The.Titans.USA.X360-ZTM.rar": {},
	"Create.USA.X360-ZTM.rar": {},
	"Crew.USA.X360-ZTM.rar": {},
	"Cross.Channel.In.Memory.of.All.People.JAP.X360-ZTM.rar": {},
	"Cross.Edge.Dash.JAP.X360-ZTM.rar": {},
	"Crysis.1.USA.X360-ZTM.rar": {},
	"Crysis.2.EUR.X360-ZTM.rar": {},
	"Crysis.3.USA.X360-ZTM.rar": {},
	"Culdcept.Saga.JAP.X360-ZTM.rar": {},
	"Culdcept.Saga.USA.X360-ZTM.rar": {},
	"Cursed.Crusade.EUR.X360-ZTM.rar": {},
	"Cursed.Crusade.USA.X360-ZTM.rar": {},
	"Cyber.Trooper.Virtua.On.Force.JAP.X360-ZTM.rar": {},
	"Damage.Inc.Pacific.Squadron.WW2.USA.X360-ZTM.rar": {},
	"Damnation.EUR.X360-ZTM.rar": {},
	"Dance.Dance.Revolution.USA.X360-ZTM.rar": {},
	"Dance.Dance.Revolution.Universe.1.USA.X360-ZTM.rar": {},
	"Dance.Dance.Revolution.Universe.2.EUR.X360-ZTM.rar": {},
	"Dance.Dance.Revolution.Universe.3.USA.X360-ZTM.rar": {},
	"Dantes.Inferno.EUR.X360-ZTM.rar": {},
	"Dark.Messiah.of.Might.&.Magic.Elements.USA.X360-ZTM.rar": {},
	"Dark.Sector.EUR.X360-ZTM.rar": {},
	"Dark.Souls.1.USA.X360-ZTM.rar": {},
	"Dark.Souls.2.USA.X360-ZTM.rar": {},
	"Dark.USA.X360-ZTM.rar": {},
	"Dark.Void.EUR.X360-ZTM.rar": {},
	"DarkStar.One.Broken.Alliance.USA.X360-ZTM.rar": {},
	"Darkest.of.Days.USA.X360-ZTM.rar": {},
	"Darkness.1.EUR.X360-ZTM.rar": {},
	"Darkness.1.GER.X360-ZTM.rar": {},
	"Darkness.1.JAP.X360-ZTM.rar": {},
	"Darkness.2.EUR.X360-ZTM.rar": {},
	"Darksiders.1.JAP.X360-ZTM.rar": {},
	"Darksiders.1.USA.X360-ZTM.rar": {},
	"Darksiders.2.JAP.X360-ZTM.rar": {},
	"FIFA.15.USA.X360-ZTM.rar": {},
	"FIFA.16.USA.X360-ZTM.rar": {},
	"FIFA.17.EUR.X360-ZTM.rar": {},
	"FIFA.18.USA.X360-ZTM.rar": {},
	"FIFA.19.USA.X360-ZTM.rar": {},
	"FIFA.Street.3.USA.X360-ZTM.rar": {},
	"FIFA.Street.4.USA.X360-ZTM.rar": {},
	"Fight.Night.Champion.USA.X360-ZTM.rar": {},
	"Fight.Night.Round.3.EUR.X360-ZTM.rar": {},
	"Fight.Night.Round.4.EUR.X360-ZTM.rar": {},
	"Final.Fantasy.11.Ultimate.Collection.Seekers.Edition.USA.X360-ZTM.rar": {},
	"Final.Fantasy.13-2.EUR.X360-ZTM.rar": {},
	"Final.Fantasy.13.EUR.X360-ZTM.rar": {},
	"Final.Fantasy.13.Lightning.Returns.USA.X360-ZTM.rar": {},
	"First.Templar.USA.X360-ZTM.rar": {},
	"Fist.of.The.North.Star.Kens.Rage.1.EUR.X360-ZTM.rar": {},
	"MLB.Front.Office.Manager.USA.X360-ZTM.rar": {},
	"MX.vs.ATV.Alive.USA.X360-ZTM.rar": {},
	"MX.vs.ATV.Reflex.USA.X360-ZTM.rar": {},
	"PES 2026 Fl Patch Janeiro.zip": {},
	"Peter.Jacksons.King.Kong.USA.X360-ZTM.rar": {},
	"Phantasy.Star.Universe.USA.X360-ZTM.rar": {},
	"Phantom.Breaker.Extra.JAP.X360-ZTM.rar": {},
	"Phantom.Breaker.JAP.X360-ZTM.rar": {},
	"Phantom.Phantom.of.Inferno.JAP.X360-ZTM.rar": {},
	"Phineas.&.Ferb.Quest.For.Cool.Stuff.USA.X360-ZTM.rar": {},
	"Pia.Carrot e.Youkoso.4.Natsu.no.Koikatsu.JAP.X360-ZTM.rar": {},
	"Pictionary.Ultimate.Edition.USA.X360-ZTM.rar": {},
	"Pimp.My.Ride.USA.X360-ZTM.rar": {},
	"Pinball.Hall.of.Fame.The.Williams.Collection.USA.X360-ZTM.rar": {},
	"Pirates.of.The.Caribbean.At.Worlds.End.USA.X360-ZTM.rar": {},
	"Planet.51.The.Game.USA.X360-ZTM.rar": {},
	"Plants.vs.Zombies.Garden.Warfare.USA.X360-ZTM.rar": {},
	"PocketBike.Racer.USA.X360-ZTM.rar": {},
	"Port.Royale.3.Pirates.&.Merchants.USA.X360-ZTM.rar": {},
	"Portal.2.USA.X360-ZTM.rar": {},
	"PowerGig.Rise.of.The.SixString.USA.X360-ZTM.rar": {},
	"Prey.EUR.X360-ZTM.rar": {},
	"Price.Is.Right.Decades.USA.X360-ZTM.rar": {},
	"Prince.of.Persia.EUR.X360-ZTM.rar": {},
	"Prince.of.Persia.The.Forgotten.Sands.EUR.X360-ZTM.rar": {},
	"Prison.Break.The.Conspiracy.EUR.X360-ZTM.rar": {},
	"Pro.Evolution.Soccer.2007.EUR.X360-ZTM.rar": {},
	"Pro.Evolution.Soccer.2007.JAP.X360-ZTM.rar": {},
	"Pro.Evolution.Soccer.2007.USA.X360-ZTM.rar": {},
	"Pro.Evolution.Soccer.2008.EUR.X360-ZTM.rar": {},
	"Pro.Evolution.Soccer.2008.JAP.X360-ZTM.rar": {},
	"Pro.Evolution.Soccer.2008.USA.X360-ZTM.rar": {},
}
