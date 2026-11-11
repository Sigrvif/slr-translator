$LOAD_PATH.unshift(File.expand_path("../../www/php/plugins/rmvxace/bin", __dir__))
require "rules"

def t_rules
  ace = Rules.for(:ace)
  assert_eq(
    [["name", :string, nil], ["nickname", :string, nil], ["description", :string, nil], ["note", :string, nil]],
    ace["RPG::Actor"], "ace Actor field order"
  )
  assert_eq([["game_title", :string, nil], ["currency_unit", :string, nil],
             ["elements", :str_array, nil], ["skill_types", :str_array, nil],
             ["weapon_types", :str_array, nil], ["armor_types", :str_array, nil],
             ["terms", :object, nil]],
            ace["RPG::System"], "ace System field order")
  assert_eq([["basic", :str_array, nil], ["parameters", :str_array, "@params"],
             ["equipment types", :str_array, "@etypes"], ["commands", :str_array, nil]],
            ace["RPG::System::Terms"], "ace Terms incl. @params/@etypes ivar overrides")
  assert_eq([["display_name", :string, nil], ["note", :string, nil], ["events", :hash, nil]],
            ace["RPG::Map"], "ace Map fields")
  assert_eq([["name", :string, nil], ["commands", :commands, "@list"]],
            ace["RPG::CommonEvent"], "ace CommonEvent fields (commands -> @list ivar)")

  xp = Rules.for(:xp)
  assert_eq([["name", :string, nil]], xp["RPG::Actor"], "xp Actor has name only")
  assert_eq([["elements", :str_array, nil], ["switches", :str_array, nil],
             ["variables", :str_array, nil], ["words", :object, nil]],
            xp["RPG::System"], "xp System fields")
  assert(xp["RPG::System::Words"].length == 20, "xp Words has 20 fields")
  assert_eq([["gold", :string, nil], ["hp", :string, nil]], xp["RPG::System::Words"][0, 2], "xp Words starts gold,hp")

  vx = Rules.for(:vx)
  assert_eq([["name", :string, nil], ["description", :string, nil], ["note", :string, nil],
             ["message1", :string, nil], ["message2", :string, nil]],
            vx["RPG::Skill"], "vx Skill field order")
  assert_eq([["game_title", :string, nil], ["terms", :object, nil], ["elements", :str_array, nil],
             ["switches", :str_array, nil], ["variables", :str_array, nil]],
            vx["RPG::System"], "vx System field order")
  assert(vx["RPG::System::Terms"].length == 33, "vx Terms has 33 fields")
  assert(vx["RPG::Area"] == [["name", :string, nil]], "vx Area")

  assert_eq({ 401 => 401, 108 => 408, 355 => 655 }, Rules::MERGE_CONT[:ace], "ace merge map")
  assert_eq({ 101 => 401, 108 => 408, 355 => 655 }, Rules::MERGE_CONT[:xp], "xp merge map")
end
t_rules
