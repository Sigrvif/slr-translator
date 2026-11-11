# rules.rb — per-engine translatable-field tables for the RPG Maker data classes.
#
# Each class maps to an ordered list of [json_key, kind, ivar_override] where
# ivar defaults to "@#{json_key}". Kinds:
#   :string    single translatable string          -> TranslatableString
#   :str_array mixed array (strings translatable)  -> wrapped array
#   :object    nested object dumped by its own rules
#   :hash      Hash{int -> object}, dumped sorted as [[k, obj], ...]
#   :commands  event-command list (merge/dump/apply/split)
# The field lists, key order, and event type names are format facts of the
# RPG Maker data files; the rule representation is original.
require_relative "event_codes"

module Rules
  MERGE_CONT = {
    ace: { 401 => 401, 108 => 408, 355 => 655 }.freeze,
    vx:  { 401 => 401, 108 => 408, 355 => 655 }.freeze,
    xp:  { 101 => 401, 108 => 408, 355 => 655 }.freeze,
  }.freeze

  VX_TERMS = %w[
    level level_a hp hp_a mp mp_a atk def spi agi
    weapon armor1 armor2 armor3 armor4 weapon1 weapon2
    attack skill guard item equip status save game_end
    fight escape new_game continue shutdown to_title cancel gold
  ].freeze

  XP_WORDS = %w[
    gold hp sp str dex agi int atk pdef mdef
    weapon armor1 armor2 armor3 armor4
    attack skill guard item equip
  ].freeze

  # Singleton helpers (called unqualified at module body level while building
  # the tables below; `self` there is the Rules module). All tuples use STRING
  # json keys (byte-parity with the legacy JSON output) and carry an explicit
  # ivar override wherever the JSON key differs from "@#{key}".
  def self.s(*names); names.map { |n| [n.to_s, :string, nil] }; end
  def self.a(*names); names.map { |n| [n.to_s, :str_array, nil] }; end
  def self.one(name); [name.to_s, :object, nil]; end
  def self.cmds; ["commands", :commands, "@list"]; end
  def self.lst(name); [name.to_s, :list, nil]; end
  def self.hsh(name); [name.to_s, :hash, nil]; end

  ACE = {
    "RPG::Actor"            => s(:name, :nickname, :description, :note),
    "RPG::Class"            => s(:name, :description, :note) + [lst(:learnings)],
    "RPG::Class::Learning"  => s(:note),
    "RPG::Skill"            => s(:name, :description, :message1, :message2, :note),
    "RPG::Item"             => s(:name, :description, :note),
    "RPG::Weapon"           => s(:name, :description, :note),
    "RPG::Armor"            => s(:name, :description, :note),
    "RPG::Enemy"            => s(:name, :description, :note),
    "RPG::State"            => s(:name, :message1, :message2, :message3, :message4, :note),
    "RPG::Animation"        => s(:name),
    "RPG::Tileset"          => s(:name),
    "RPG::MapInfo"          => s(:name),
    "RPG::CommonEvent"      => s(:name) + [cmds],
    "RPG::Map"              => s(:display_name, :note) + [hsh(:events)],
    "RPG::Event"            => s(:name) + [lst(:pages)],
    "RPG::Event::Page"      => [cmds],
    "RPG::Troop"            => s(:name) + [lst(:pages)],
    "RPG::Troop::Page"      => [cmds],
    "RPG::System"           => s(:game_title, :currency_unit) +
                               a(:elements, :skill_types, :weapon_types, :armor_types) +
                               [one(:terms)],
    "RPG::System::Terms"    => a(:basic) +
                               [["parameters", :str_array, "@params"]] +
                               [["equipment types", :str_array, "@etypes"]] +
                               a(:commands),
  }.freeze

  XP = {
    "RPG::Actor"            => s(:name),
    "RPG::Class"            => s(:name),
    "RPG::Skill"            => s(:name, :description),
    "RPG::Item"             => s(:name, :description),
    "RPG::Weapon"           => s(:name, :description),
    "RPG::Armor"            => s(:name, :description),
    "RPG::Enemy"            => s(:name),
    "RPG::Troop"            => s(:name) + [lst(:pages)],
    "RPG::Troop::Page"      => [cmds],
    "RPG::State"            => s(:name),
    "RPG::Event"            => s(:name) + [lst(:pages)],
    "RPG::Event::Page"      => [cmds],
    "RPG::MapInfo"          => s(:name),
    "RPG::Map"              => [hsh(:events)],
    "RPG::Animation"        => s(:name),
    "RPG::Tileset"          => s(:name),
    "RPG::CommonEvent"      => s(:name) + [cmds],
    "RPG::System"           => a(:elements, :switches, :variables) + [one(:words)],
    "RPG::System::Words"    => s(*XP_WORDS.map(&:to_sym)),
  }.freeze

  VX = {
    "RPG::Actor"            => s(:name),
    "RPG::Class"            => s(:name),
    "RPG::Skill"            => s(:name, :description, :note, :message1, :message2),
    "RPG::Item"             => s(:name, :description, :note),
    "RPG::Weapon"           => s(:name, :description, :note),
    "RPG::Armor"            => s(:name, :description, :note),
    "RPG::Enemy"            => s(:name, :note),
    "RPG::Troop"            => s(:name) + [lst(:pages)],
    "RPG::Troop::Page"      => [cmds],
    "RPG::State"            => s(:name, :message1, :message2, :message3, :message4, :note),
    "RPG::Animation"        => s(:name),
    "RPG::CommonEvent"      => s(:name) + [cmds],
    "RPG::MapInfo"          => s(:name),
    "RPG::Area"             => s(:name),
    "RPG::Map"              => [hsh(:events)],
    "RPG::Event"            => s(:name) + [lst(:pages)],
    "RPG::Event::Page"      => [cmds],
    "RPG::System"           => s(:game_title) + [one(:terms)] +
                               a(:elements, :switches, :variables),
    "RPG::System::Terms"    => s(*VX_TERMS.map(&:to_sym)),
  }.freeze

  TABLES = { ace: ACE, xp: XP, vx: VX }.freeze

  def self.for(engine)
    TABLES[engine]
  end

  def self.engine_for_ext(ext)
    case ext
    when ".rxdata"  then :xp
    when ".rvdata"  then :vx
    when ".rvdata2" then :ace
    end
  end
end
