ShowTrak Flow is an application for monitoring linear fow for immersive theatre shows.

There are a few concepts to implement:


A "Flow" is a collection of groups in an order, for instance i might have a "Monday" flow which is all the groups with the metadata pre stored for them to prepare a monday show or i might have a "bank holiday" flow for a special case. I should have as many flows as i want, i should be able to re-order them with drag and drop within a flows manager. I should be able to "Load" a flow to load these groups into the queue. Flow should have its own tab in the sidebar.

The queue is a list of groups that are "Upcoming" it should have its own tab in the sidebar. Within here, groups should be able to be edited. Any changes made to groups from this point should not be saved as changes to the flow, just temporary changes to the currently running instance. We want these changes to be persisted accross restarts within the context of the currently running show in order to provide crash recovery however we will eventually need to be able to reset the queue and "Active Show" completely to a blank state where we can reload a flow.

A group is a concept for storing information about a group of people entering a show. Typically groups would enter at scheduled times but not always. As such we should make most fields in groups optional. Here are the properties we will need.

ID (Auto generated but customisable alphanumeric without spaces)
Time (Optional HH:MM)
Colour (Hex Code), we will eventually add show specific colour configuration to give a pallette, just give a hex editor for now.
Label (Mandatory)
Notes (An array of messages, this will be used for notes about groups to be added so that as they move through the show they are visible to teams.) They will only be visibile to users on progressive disclosure.
Flags (An array of flags added to a group, these flags should be definable in show settings. Each predefined flag should have a Label and a Bootstrap Icon (entered as text for now) as well as an optional comment. They should also have a timestamp stored as a unix epoch and an author id, defaulting to 0 for now.)

Finally, we have scenes. Scenes are the main body of the app and is what the main application section should be used for.

Each scene should be a long thin horizontal card. It should have the scene Label on the left, a progress bar and a section for a group that is in a scene. There should be the possibility of multiple groups being in a scene but in most instances only 1 group will be in a scene.

The group/groups that are in the scene should take up about half of the width of the scene width showing the group colour, label, icons for flags and an unread chats indicator.

Scenes should have an optional duration value.

Scenes should have "milestones" which are timestamps within a scene that different events happen, this is so that they can show as lines on the scene progress bar to indicate when things should happen. Each milestone should have a hex colour assigned to it which will be the colour of the indicator.

When in edit mode, a small edit button (not using the word edit but instead a button with a boostrap edit icon) should be visible in each scene and in each group