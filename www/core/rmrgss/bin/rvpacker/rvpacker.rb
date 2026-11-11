#!/usr/bin/env ruby
# -*- coding: utf-8 -*-

require 'optimist'
require 'RGSS'

if ARGV.length <1 then
  puts <<-HEREDOC
  RVPACKER thin
  Based on rvpacker project:https://github.com/Husky2490/rvpacker

  rvpacker is a tool to unpack & pack RPGMaker XP, VX, VX Ace data files into YAML format

  Options:
   --action, -a <s>     : Action to perform on project (unpack|pack)
   --project, -d <s>    : RPG Maker Project directory
   --force, -f          : Update target even when source is older than target
   --project-type, -t <s>: Project type (vx|ace|xp)
   --help, -h           : Show this message
   --verbose, -V        : Verbose
   --Target, -T         : Target directory to write into/from
   --paths-file, -F <s> : JSON file (UTF-8) with {project, target} paths.
                          Workaround for non-ASCII paths on Windows, where
                          argv is decoded with the system ANSI code page.

  Example:
    Unpacking:
      rvpacker --action unpack --project /path/to/your/game/folder --project-type ace

    Unpacking to custom destination folder:
      rvpacker -a unpack -d /path/to/your/game/folder -t ace -T /destination/folder -V

    Repacking:
      rvpacker --action pack --project /path/to/your/game/folder --project-type ace


  HEREDOC
  exit 1
end

opts = Optimist::options do
  opt :action, "Action to perform on project (unpack|pack)", :short => "a", :type => String
  opt :project, "RPG Maker Project directory", :short => "d", :type => String
  opt :force, "Update target even when source is older than target", :short => "f"
  opt :project_type, "Project type (vx|ace|xp)", :short => "t", :type => String
  opt :verbose, "Print verbose information while processing", :short => "V"
  opt :database, "Only work on the given database", :short => "D", :type => String
  opt :target, "Target directory to write into/from", :short => "T", :type => String
  opt :paths_file, "JSON file (UTF-8) with {project, target} paths. Workaround for non-ASCII paths on Windows.", :short => "F", :type => String
end

# On Windows the process arguments are decoded using the system ANSI code
# page (the active locale), so non-ASCII characters in a path (e.g. a
# Japanese project folder on an English locale) are turned into '?'. When
# --paths-file is supplied, read the real project/target paths back from a
# UTF-8 JSON manifest so the actual on-disk location is recovered.
# The manifest is parsed with Psych (JSON is valid YAML) because the bundled
# Windows Ruby does not include the json gem, while Psych ships with it
# (rvpacker itself already depends on Psych).
project_dir = opts[:project]
target_dir  = opts[:target]
if opts[:paths_file]
  require 'psych'
  paths = Psych.load(File.read(opts[:paths_file], :encoding => 'utf-8'))
  project_dir = paths['project'] if paths['project']
  target_dir  = paths['target']  if paths['target']
end

directions = {
  "unpack" => :all_bin_to_text,
  "pack" => :all_text_to_bin
}
projecttypes = {
  "vx" => :vx,
  "ace" => :ace,
  "xp" => :xp
}
$VERBOSE=opts[:verbose]

RGSS.serialize(projecttypes[opts[:project_type]],
               directions[opts[:action]],
               project_dir,
               { :force => (opts[:force] ? true : false),
                 :line_width => -1,
                 :table_width => -1,
                 :database => opts[:database],
                 :output => (target_dir ? target_dir : project_dir)
               }
               )
