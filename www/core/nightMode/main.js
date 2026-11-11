var thisAddon     = this;
var appName     = this.package.name;

this.optionsForm = {
        "booleanValue": {
          "type": "boolean",
          "title": "Night mode",
          "description": "Invert the dark and bright colors",
          "required":true,
          "default":true,
          "HOOK": "thisAddon.config.isActive",
          "inlinetitle": "Activate night mode",
          "onChange": function(evt) {
                console.log("onInput triggered");
                console.log("This", this);
                console.log("Arguments", arguments);
                if (this.prop("checked")) {
                    thisAddon.nightMode.on();
                } else {
                    thisAddon.nightMode.off();
                }
                sys.saveConfig();
          }
        }
}

var NightMode = function() {
    
}

NightMode.prototype.on = function() {
    var $css = `<link type="text/css" href="core/nightMode/css/!nightMode.css" class="nightModeCss" rel="stylesheet" media="screen" />`;
    $("head").append($css);
    $("body").addClass("nightMode");
    for (var i in ui.windows) {
        if (!Boolean(ui.windows[i])) continue;
        try {
            ui.windows[i].$("head").append($css);
            ui.windows[i].$("body").addClass("nightMode");
            
        } catch (e) {
            
        }
    }
    
    window.scriptRunner.applyScript("/www/options.html", "onReady", "nightMode", function() {
        var $css = `<link type="text/css" href="core/nightMode/css/!nightMode.css" class="nightModeCss" rel="stylesheet" media="screen" />`;
        $("head").append($css);
        $("body").addClass("nightMode");

    });
    window.scriptRunner.applyScript("/www/find.html", "onReady", "nightMode", function() {
        var $css = `<link type="text/css" href="core/nightMode/css/!nightMode.css" class="nightModeCss" rel="stylesheet" media="screen" />`;
        $("head").append($css);
        $("body").addClass("nightMode");

    });
    window.scriptRunner.applyScript("/www/core/sugoiTrans/serverManager.html", "onReady", "nightMode", function() {
        var $css = `<link type="text/css" href="core/nightMode/css/!nightMode.css" class="nightModeCss" rel="stylesheet" media="screen" />`;
        $("head").append($css);
        $("body").addClass("nightMode");

    });
}

NightMode.prototype.off = function() {
    $("link.nightModeCss").remove();
    $("body").removeClass("nightMode");
    for (var i in ui.windows) {
        if (!Boolean(ui.windows[i])) continue;
        try {
            ui.windows[i].$("link.nightModeCss").remove();
            ui.windows[i].$("body").removeClass("nightMode");
        } catch (e) {
            
        }
    }    
    
    window.scriptRunner.applyScript("/www/options.html", "onReady", "nightMode", undefined);
    window.scriptRunner.applyScript("/www/find.html", "onReady", "nightMode", undefined);
    window.scriptRunner.applyScript("/www/core/sugoiTrans/serverManager.html", "onReady", "nightMode", undefined);
}

NightMode.prototype.initState = function() {
    // init state when current window is opening
    if (thisAddon.config.isActive||thisAddon.config.isActive == undefined) {
        this.on();
    } else {
        this.off();
    }
}

thisAddon.nightMode = new NightMode();

$(document).ready(function() {
    thisAddon.nightMode.initState();
});